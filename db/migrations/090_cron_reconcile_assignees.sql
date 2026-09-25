-- 090_cron_reconcile_assignees
-- Passo 5 do plano definitivo de atribuição de responsáveis (24/09/2026).
--
-- PROBLEMA: reconcile_assignees existe desde a 086 mas é MANUAL — alguém precisa
-- lembrar de chamar a edge. Na prática ninguém chama, e o estado de
-- clickup_assignee_sync envelhece: uma divergência que o webhook não viu (evento
-- perdido, task editada enquanto o webhook estava fora do ar, demanda criada antes da
-- feature) fica invisível para sempre. O cron diário é a rede de segurança do webhook.
--
-- POR QUE 1×/DIA E NÃO MAIS: o webhook é o caminho normal e é em tempo real. Este cron
-- só cobre o que ele perdeu — e o que ele perde não muda de hora em hora. Cada
-- execução gasta ~350 ms de throttle + 1 GET /task por demanda contra a API do ClickUp;
-- rodar de hora em hora seria 24× a chamada para pegar o mesmo passivo parado. A
-- pergunta 3 do PROTOCOLO-SUSTENTABILIDADE ("o intervalo corresponde ao ritmo em que o
-- dado muda de verdade?") responde: não, o passivo é diário na melhor das hipóteses.
--
-- 04:00 UTC = 01:00 BRT — fora do horário de operação, e o slot 0 4 * * * já é usado
-- por portal-sync-overdue-subscriptions sem conflito de recurso (são cargas pequenas).
--
-- TETO: a edge recebe {all:true, limit:25} e encadeia até 4 lotes = 100 demandas por
-- execução (RECONCILE_MAX_BATCHES em clickup-sync v15), devolvendo `batches` e
-- `stopped_reason`. pg_cron dispara UMA chamada HTTP e vai embora — não existe quem
-- leia o next_cursor e continue, então o encadeamento TEM que ser interno à edge.
-- Sem isso o cron reconciliaria eternamente só as 25 demandas mais antigas.
-- `stopped_reason='batch_cap'` recorrente = o passivo passou de 100/dia e alguma coisa
-- está errada a montante; é para aparecer em cron.job_run_details, não ser absorvido.
--
-- PADRÃO DO PROJETO: não existe `_bot_cron_invoke` neste banco (conferido por grep em
-- db/migrations/**). O padrão vigente — migrations 066, 068, 070, 072 — é uma função
-- portal._<nome>() SECURITY DEFINER que lê a chave interna do Vault
-- (vault.decrypted_secrets, name='clickup_sync_internal_key') e faz net.http_post na
-- edge; o cron.schedule chama essa função. É o que se segue aqui, sem inventar
-- mecanismo novo.
--
-- Aplicar via `supabase db push` ou MCP apply_migration name=090_cron_reconcile_assignees.
-- ⚠️ cron.schedule exige a extensão pg_cron (já em uso: expirar-sessoes,
-- idempotency-cleanup, portal-sync-overdue-subscriptions, retry-clickup-attachments,
-- retry-failed-emails).

-- ── Wrapper: dispara a edge clickup-sync em modo reconciliação ─────────────
CREATE OR REPLACE FUNCTION portal._cron_reconcile_assignees()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public', 'vault', 'net', 'pg_catalog'
AS $function$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'clickup_sync_internal_key';
  IF v_key IS NULL THEN
    -- Best-effort, igual a _retry_failed_emails/_resync_demand_assignees: sem a chave
    -- não há o que fazer, mas derrubar o job encheria cron.job_run_details de 'failed'
    -- sem informação melhor que este WARNING.
    RAISE WARNING 'clickup_sync_internal_key ausente — reconcile-assignees ignorado';
    RETURN;
  END IF;

  -- timeout generoso: a edge pode levar até ~60 s encadeando 4 lotes de 25 demandas
  -- (350 ms de throttle + GET /task cada). O net.http_post é assíncrono — este timeout
  -- é o da espera pela RESPOSTA, não o da execução da edge (que segue até o limite de
  -- 150 s do runtime). Não há retry: se falhar, o cron da noite seguinte cobre o mesmo
  -- passivo (é justamente isso que torna um job diário idempotente e seguro).
  PERFORM net.http_post(
    url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/clickup-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_key),
    body    := jsonb_build_object('action', 'reconcile_assignees', 'limit', 25, 'all', true),
    timeout_milliseconds := 90000
  );
END;
$function$;

-- Função de trigger/cron não deve ser chamável via PostgREST (mesmo padrão da 071/087).
-- Nasce pública: sem o REVOKE FROM PUBLIC abaixo, qualquer anon poderia disparar a
-- varredura inteira contra a API do ClickUp à vontade. Revogar só de anon NÃO resolve —
-- a permissão vem de PUBLIC e continuaria valendo por herança.
REVOKE ALL ON FUNCTION portal._cron_reconcile_assignees() FROM PUBLIC;
REVOKE ALL ON FUNCTION portal._cron_reconcile_assignees() FROM anon;
REVOKE ALL ON FUNCTION portal._cron_reconcile_assignees() FROM authenticated;
-- pg_cron roda como owner do job (postgres) — não precisa de GRANT para disparar.

COMMENT ON FUNCTION portal._cron_reconcile_assignees() IS
  'Wrapper do cron diário reconcile-assignees (migration 090): chama a edge clickup-sync
   com {action:reconcile_assignees, limit:25, all:true}. Rede de segurança do webhook —
   pega divergências que o taskAssigneeUpdated perdeu. A edge PULA demandas em
   external_* (senão o cron anularia o split da 089 todo dia).';

-- ── Agendamento ────────────────────────────────────────────────────────────
-- Idempotente: unschedule antes (re-aplicar a migration não cria job duplicado nem
-- falha por nome já existente). O IF EXISTS na subquery evita o erro
-- "could not find valid entry for job" quando o job ainda não existe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-assignees') THEN
    PERFORM cron.unschedule('reconcile-assignees');
  END IF;
  PERFORM cron.schedule(
    'reconcile-assignees',
    '0 4 * * *',
    $cron$select portal._cron_reconcile_assignees();$cron$
  );
END;
$$;

-- ── Drift-check: acrescenta `assignee_alert_to` às chaves esperadas ────────
-- portal.get_schema_drift_status() (migration 087) valida que as chaves de
-- portal.clickup_config que o código espera existem de fato no banco. A chave
-- `assignee_alert_to` entrou na 088 (roteamento do alerta de divergência para um dono
-- único, decisão 1 do Marcio) e NÃO foi acrescentada a essa lista — resultado: a tela
-- de drift do painel admin reportaria "ok" mesmo com a 088 não aplicada, que é
-- exatamente o cenário que a RPC existe para detectar. Achado do kirad na revisão de
-- 24/09/2026.
--
-- ⚠️ O corpo abaixo é CÓPIA LITERAL da função na 087, com UMA única alteração: a
-- adição de 'assignee_alert_to' ao array de chaves. Conferido por diff (1 linha
-- alterada, nenhuma outra). Não é refatoração — `CREATE OR REPLACE` substitui o corpo
-- inteiro, então qualquer divergência acidental aqui viraria regressão silenciosa na
-- tela de drift.
-- Assinatura idêntica à da 087 — (boolean) — de propósito: `CREATE OR REPLACE` com
-- assinatura diferente CRIA SOBRECARGA em vez de substituir, e o chamador antigo
-- continuaria na função velha.
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
    FROM unnest(ARRAY['assignee_strategy','assignee_alert_email','assignee_alert_to','space_multi_assignee_cache','guest_clickup_ids_cache']) AS k
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
