-- 087_operator_notifiable_and_drift_status
-- Duas frentes independentes deste lote (arquiteto, 2026-09-03):
--
-- B1) portal.operators.clickup_notifiable — vira ATRIBUTO da pessoa (derivado do
--     cache de guests já mantido por clickup-sync em clickup_config.guest_clickup_ids_cache),
--     em vez de descoberta por demanda a cada comparação. Guest não pode ser assignee
--     nem watcher no ClickUp (ver 086) — quando clickup_notifiable=false, o portal sabe
--     ANTES de mandar a task que esse operador não vai ser notificado por lá, e o
--     send-email manda um e-mail com o link da task para ele (reuso de
--     resolveDemandOperators, já existe em send-email). Trigger AFTER INSERT em
--     demand_operators dispara o e-mail (type:'demanda_atribuida_guest') só quando o
--     operador recém-atribuído é guest — mesmo padrão de pg_net das migrations 046/059.
--
-- B2) portal.get_schema_drift_status() — RPC cacheada que compara as colunas
--     ESPERADAS pelo código (lista mantida à mão, ver PORTAL_EXPECTED_COLUMNS abaixo)
--     contra information_schema.columns real do schema portal, para a tela de drift
--     repo×banco do painel admin. Cache em tabela (portal.schema_drift_cache) com TTL
--     curto: a query em information_schema é barata (poucas centenas de linhas, schema
--     único), mas cachear evita reconsultar a cada refresh de tela.

-- ── B1: atributo de notificabilidade por operador ──────────────────────────
ALTER TABLE portal.operators
  ADD COLUMN IF NOT EXISTS clickup_notifiable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN portal.operators.clickup_notifiable IS
  'false = operador é GUEST no ClickUp (não pode ser assignee nem watcher — ITEM_087/
   ITEM_096, descartado em silêncio pelo ClickUp quando misturado com member). Mantido
   pela reconciliação (clickup-sync, a partir de guest_clickup_ids_cache) — não editar
   à mão fora de teste. Quando false, send-email notifica o operador por e-mail com o
   link da task (ele não vai saber pelo ClickUp).';

-- Índice parcial: a única consulta real sobre esta coluna é "quem é guest" (para o
-- painel de equipe marcar o badge) — poucas linhas, mas o predicado é seletivo e
-- barato de manter.
CREATE INDEX IF NOT EXISTS idx_operators_not_notifiable
  ON portal.operators (id) WHERE clickup_notifiable = false;

-- Trigger: operador ATRIBUÍDO a uma demanda (INSERT em demand_operators) → se ele é
-- guest (clickup_notifiable=false), dispara o e-mail com o link da task (send-email,
-- type:'demanda_atribuida_guest'). Mesmo padrão pg_net das migrations 046/059
-- (vault.decrypted_secrets + net.http_post, best-effort — RAISE WARNING sem chave,
-- nunca derruba o INSERT).
CREATE OR REPLACE FUNCTION portal._notify_demanda_atribuida_guest()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public', 'vault', 'net', 'pg_catalog'
AS $function$
DECLARE
  v_internal_key text;
  v_notifiable boolean;
BEGIN
  SELECT clickup_notifiable INTO v_notifiable FROM portal.operators WHERE id = NEW.operator_id;
  IF v_notifiable IS DISTINCT FROM false THEN
    RETURN NEW; -- operador normal (ou não encontrado) — nada a avisar por e-mail
  END IF;

  SELECT decrypted_secret INTO v_internal_key
    FROM vault.decrypted_secrets WHERE name = 'clickup_sync_internal_key';
  IF v_internal_key IS NULL THEN
    RAISE WARNING 'internal key ausente — e-mail demanda_atribuida_guest ignorado';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_internal_key),
    body    := jsonb_build_object('type', 'demanda_atribuida_guest', 'demand_id', NEW.demand_id, 'operator_id', NEW.operator_id),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS demand_operators_notify_guest ON portal.demand_operators;
CREATE TRIGGER demand_operators_notify_guest
  AFTER INSERT ON portal.demand_operators
  FOR EACH ROW EXECUTE FUNCTION portal._notify_demanda_atribuida_guest();

-- Função de trigger não deve ser chamável via PostgREST (mesmo padrão da 071) —
-- pg_cron/trigger rodam como owner (SECURITY DEFINER), revogar EXECUTE de
-- public/anon/authenticated não afeta o disparo automático, só fecha a porta de um
-- usuário logado invocá-la direto para disparar e-mail arbitrário.
REVOKE EXECUTE ON FUNCTION portal._notify_demanda_atribuida_guest() FROM public, anon, authenticated;

-- ── B2: cache do status de drift (schema esperado × information_schema real) ──
CREATE TABLE IF NOT EXISTS portal.schema_drift_cache (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton: 1 linha só
  computed_at  timestamptz NOT NULL DEFAULT now(),
  result       jsonb NOT NULL
);

COMMENT ON TABLE portal.schema_drift_cache IS
  'Cache singleton (1 linha) do resultado de portal.get_schema_drift_status(). TTL
   aplicado no código da função (recomputa se computed_at estiver velho), não por cron.';

ALTER TABLE portal.schema_drift_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schema_drift_cache_admin ON portal.schema_drift_cache;
CREATE POLICY schema_drift_cache_admin ON portal.schema_drift_cache
  FOR SELECT TO authenticated USING (portal.is_admin());
-- Sem policy de INSERT/UPDATE para authenticated: só a função SECURITY DEFINER escreve.

GRANT SELECT ON portal.schema_drift_cache TO authenticated;

-- Lista de colunas ESPERADAS pelo código, mantida à mão (mesmo espírito de um
-- schema.lock versionado, mas consultável por SQL/RPC em vez de arquivo solto).
-- Cobre só as tabelas tocadas por este lote de deploy automatizado (086/087)
-- — não é um dicionário de dados completo do schema portal.
CREATE OR REPLACE FUNCTION portal._expected_columns()
 RETURNS TABLE (table_name text, column_name text)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT * FROM (VALUES
    ('demands', 'clickup_assignee_sync'),
    ('demands', 'clickup_assignee_detail'),
    ('demand_operators', 'clickup_delivery'),
    ('demand_operators', 'clickup_delivery_at'),
    ('operators', 'clickup_notifiable'),
    ('clickup_config', 'assignee_strategy'),   -- key, não column — ver nota abaixo
    ('clickup_config', 'assignee_alert_email') -- idem
  ) AS t(table_name, column_name)
  -- clickup_config é key/value: as duas últimas linhas acima descrevem CHAVES
  -- esperadas, não colunas — removidas da comparação de colunas (ficam de fora do
  -- information_schema.columns por definição) e checadas à parte em result.config_keys.
  WHERE table_name <> 'clickup_config';
$function$;

-- RPC cacheada consumida pela tela de drift do painel admin. p_force_refresh=true
-- ignora o cache (uso manual, ex. logo após rodar o workflow de deploy).
CREATE OR REPLACE FUNCTION portal.get_schema_drift_status(p_force_refresh boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public'
AS $function$
DECLARE
  v_cached portal.schema_drift_cache;
  v_missing jsonb;
  v_config_missing jsonb;
  v_result jsonb;
BEGIN
  IF NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Apenas admin pode consultar o status de drift do schema.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cached FROM portal.schema_drift_cache WHERE id = 1;
  -- TTL de 5 min: a tela pode dar refresh sem custo, mas não recomputa a cada render.
  IF NOT p_force_refresh AND v_cached.id IS NOT NULL AND v_cached.computed_at > now() - interval '5 minutes' THEN
    RETURN v_cached.result;
  END IF;

  -- Colunas esperadas (código) que NÃO existem em information_schema.columns (schema real).
  SELECT coalesce(jsonb_agg(jsonb_build_object('table', e.table_name, 'column', e.column_name)), '[]'::jsonb)
    INTO v_missing
    FROM portal._expected_columns() e
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'portal' AND c.table_name = e.table_name AND c.column_name = e.column_name
   );

  -- Chaves esperadas em clickup_config que ainda não foram inseridas (migration
  -- rodou o DDL mas o INSERT ... ON CONFLICT DO NOTHING pode ter sido pulado se a
  -- tabela não existir ainda, ou a migration não rodou de todo).
  SELECT coalesce(jsonb_agg(k), '[]'::jsonb) INTO v_config_missing
    FROM unnest(ARRAY['assignee_strategy','assignee_alert_email','space_multi_assignee_cache','guest_clickup_ids_cache']) AS k
   WHERE NOT EXISTS (SELECT 1 FROM portal.clickup_config cc WHERE cc.key = k);

  v_result := jsonb_build_object(
    'ok', (v_missing = '[]'::jsonb AND v_config_missing = '[]'::jsonb),
    'missing_columns', v_missing,
    'missing_config_keys', v_config_missing,
    'checked_at', now()
  );

  INSERT INTO portal.schema_drift_cache (id, computed_at, result)
  VALUES (1, now(), v_result)
  ON CONFLICT (id) DO UPDATE SET computed_at = excluded.computed_at, result = excluded.result;

  RETURN v_result;
END;
$function$;

-- Função nova em schema exposto nasce pública — GRANT explícito só para authenticated.
GRANT EXECUTE ON FUNCTION portal.get_schema_drift_status(boolean) TO authenticated;
