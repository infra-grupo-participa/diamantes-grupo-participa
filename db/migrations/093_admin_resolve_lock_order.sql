-- 093_admin_resolve_lock_order — ordem de lock + camada GRANT na RPC de resolução
-- de divergência de responsáveis.
--
-- Origem: achado do kirad em 24/09/2026 (re-auditoria da 091). Dois problemas
-- independentes na mesma função `portal.admin_resolve_assignee_divergence` (086).
--
-- ── MOTIVO 1: DEADLOCK 40P01 POR ORDEM DE LOCK INVERTIDA ────────────────────
-- Dois caminhos escrevem nas MESMAS duas tabelas, em ordem OPOSTA:
--
--   portal.apply_clickup_assignees (091, caminho do WEBHOOK):
--     091:106  PERFORM 1 FROM portal.demands WHERE id = p_demand_id FOR UPDATE;
--     091:164  INSERT INTO portal.demand_operators ...
--     091:178  DELETE FROM portal.demand_operators ...
--     → trava `demands` PRIMEIRO, depois `demand_operators`.
--
--   portal.admin_resolve_assignee_divergence (086, caminho do ADMIN, accept_clickup):
--     086:267  DELETE FROM portal.demand_operators ...
--     086:274  UPDATE portal.demands ...
--     → trava `demand_operators` PRIMEIRO, depois `demands`.
--
-- Com admin e webhook agindo na MESMA demanda ao mesmo tempo:
--   T_admin   segura as linhas de demand_operators e espera a linha de demands;
--   T_webhook segura a linha de demands e espera as de demand_operators.
-- Espera cruzada → o Postgres mata uma das duas com `deadlock detected` (40P01).
-- O admin vê erro genérico no painel; o webhook perde o evento do ClickUp.
--
-- A correção é impor a MESMA ordem nos dois caminhos. A 091 já está correta e é
-- a que roda com mais frequência — então quem se alinha é a 086. Basta travar a
-- linha de `demands` ANTES de qualquer leitura/escrita, igual à 091:106.
--
-- ⚠️ O PERFORM ... FOR UPDATE vem ANTES do `SELECT * INTO v_demand`. Travar
-- depois de ler é não travar: o SELECT sem FOR UPDATE enxerga o snapshot antigo e
-- a validação de accept_clickup decidiria sobre estado já obsoleto. Não trocamos o
-- SELECT por `SELECT ... FOR UPDATE` porque o ponto é a ORDEM de aquisição de
-- lock entre as duas tabelas, e manter o PERFORM na mesma forma textual da 091
-- deixa a regra óbvia na leitura das duas funções lado a lado.
--
-- 📌 REGRA PERMANENTE (vale para toda função nova deste schema):
--    TODA função que escreve em portal.demand_operators trava a linha de
--    portal.demands com FOR UPDATE ANTES, sem exceção:
--        PERFORM 1 FROM portal.demands WHERE id = <demanda> FOR UPDATE;
--    `demands` → `demand_operators`. Nunca o inverso.
--
-- ── PENDÊNCIA CONHECIDA (NÃO corrigida nesta migration, de propósito) ───────
-- Grep por escritas em demand_operators mostrou que a 059 também viola a regra —
-- escreve sem travar `demands` antes:
--
--   db/migrations/059_admin_manage_demand_operators.sql:45
--     portal.admin_add_demand_operator → INSERT INTO portal.demand_operators
--     (a linha :41 faz apenas `IF NOT EXISTS (SELECT 1 FROM portal.demands ...)` —
--      teste de existência SEM FOR UPDATE, não trava nada)
--   db/migrations/059_admin_manage_demand_operators.sql:67
--     portal.admin_remove_demand_operator → DELETE FROM portal.demand_operators
--     (não lê `demands` em momento nenhum)
--
-- Confirmado: `grep -n "FOR UPDATE" db/migrations/059_*.sql` → zero ocorrências.
-- Ambas chamam `portal._resync_demand_assignees(p_demand_id)` em seguida, então
-- competem com o webhook pela mesma demanda e têm o mesmo potencial de 40P01.
-- Ficam FORA desta migration por escopo (o achado do kirad é sobre a 086);
-- tratar em migration própria. Registrado aqui para não se perder.
--
-- ── MOTIVO 2: EXECUTE PARA PUBLIC (camada GRANT faltando) ──────────────────
-- `proacl` da função em produção, medido pelo kirad em 24/09:
--     {=X/postgres, postgres=X, service_role=X, authenticated=X}
-- A primeira entrada, `=X/postgres`, é o pseudo-role PUBLIC (grantee vazio antes
-- do `=`). Toda role herda de PUBLIC → `anon` executa a função.
--
-- A 086 fez só `GRANT EXECUTE ... TO authenticated` (086:291) e nunca revogou o
-- default. Função nova em schema exposto NASCE com EXECUTE para PUBLIC; o GRANT
-- nominal soma, não substitui.
--
-- Hoje a única defesa é o `IF NOT portal.is_admin() THEN RAISE 42501` na 1ª linha
-- do corpo — defesa ÚNICA. Basta alguém editar a função e esquecer o guard para o
-- GRANT aberto transformar o descuido em endpoint público via PostgREST.
--
-- ⚠️ `REVOKE ... FROM anon` NÃO resolve sozinho quando a permissão vem de PUBLIC:
-- o comando executa sem erro e sem efeito, porque `anon` não tem grant próprio —
-- ele herda. O revoke que importa é o de PUBLIC. Mantemos os dois: o de PUBLIC
-- corta a herança, o de anon cobre um grant nominal que possa ter sido dado fora
-- de migration.
--
-- O GRANT é camada ADICIONAL, não substituta: `portal.is_admin()` continua sendo
-- a barreira de AUTORIZAÇÃO (authenticated inclui todo usuário logado do portal,
-- não só admin). Defesa em profundidade.
--
-- ── ESCOPO ──────────────────────────────────────────────────────────────────
-- Corpo IDÊNTICO ao da 086, mais UMA linha (o PERFORM). Assinatura idêntica —
-- (p_demand_id uuid, p_action text) — porque `CREATE OR REPLACE` com assinatura
-- diferente CRIA SOBRECARGA em vez de substituir, e o chamador antigo continuaria
-- caindo na versão sem lock.
-- Reversão: db/migrations/093_down.sql

BEGIN;

CREATE OR REPLACE FUNCTION portal.admin_resolve_assignee_divergence(p_demand_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public'
AS $function$
DECLARE
  v_demand portal.demands;
  v_detail jsonb;
  v_after jsonb;
  v_after_ids text[];
  v_matched_ops uuid[];
  v_matched_clickup_ids text[];
  v_unmatched_ids text[];
BEGIN
  IF NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Apenas admin pode resolver divergência de responsáveis.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM portal.demands WHERE id = p_demand_id FOR UPDATE;
  IF p_action NOT IN ('reapply', 'accept_clickup', 'dismiss') THEN
    RAISE EXCEPTION 'Ação inválida: %', p_action;
  END IF;

  SELECT * INTO v_demand FROM portal.demands WHERE id = p_demand_id;
  IF v_demand.id IS NULL THEN
    RAISE EXCEPTION 'Demanda não encontrada.';
  END IF;

  IF p_action = 'reapply' THEN
    PERFORM portal._resync_demand_assignees(p_demand_id);
    RETURN jsonb_build_object('ok', true, 'action', p_action, 'demand_id', p_demand_id);
  END IF;

  IF p_action = 'dismiss' THEN
    UPDATE portal.demands
       SET clickup_assignee_sync = 'ok', clickup_assignee_detail = '{}'::jsonb
     WHERE id = p_demand_id;
    RETURN jsonb_build_object('ok', true, 'action', p_action, 'demand_id', p_demand_id);
  END IF;

  -- accept_clickup: usa o snapshot 'after' gravado pelo webhook (clickup_user_id
  -- de cada assignee real). Sem snapshot disponível, não há o que aplicar —
  -- devolve erro claro em vez de apagar demand_operators às cegas.
  v_detail := v_demand.clickup_assignee_detail;
  v_after := v_detail -> 'after';
  IF v_after IS NULL OR jsonb_typeof(v_after) <> 'array' OR jsonb_array_length(v_after) = 0 THEN
    RAISE EXCEPTION 'Sem estado do ClickUp registrado para aplicar (rode reconciliação ou aguarde o próximo evento do webhook).';
  END IF;

  -- IDs do ClickUp no snapshot (texto — mesmo tipo de operators.clickup_user_id,
  -- cast explícito para não depender de coerção implícita em comparação futura).
  SELECT array_agg(elem ->> 'id') INTO v_after_ids
    FROM jsonb_array_elements(v_after) AS elem
   WHERE elem ->> 'id' IS NOT NULL;

  -- 1) CASAR PRIMEIRO: quais desses IDs têm operador cadastrado.
  SELECT array_agg(o.id), array_agg(o.clickup_user_id)
    INTO v_matched_ops, v_matched_clickup_ids
    FROM portal.operators o
   WHERE o.clickup_user_id::text = ANY (v_after_ids);

  -- 2) Validar ANTES de mexer em demand_operators: sobrou algum ID do ClickUp sem
  -- cadastro correspondente (IDs fantasma, ex.: Gabriel Alves 230453991)? Se o
  -- casamento for vazio ou parcial, RAISE com a lista de quem não tem cadastro —
  -- nada de DELETE às cegas.
  SELECT array_agg(cid) INTO v_unmatched_ids
    FROM unnest(v_after_ids) AS cid
   WHERE NOT (cid = ANY (COALESCE(v_matched_clickup_ids, ARRAY[]::text[])));

  IF v_matched_ops IS NULL OR array_length(v_matched_ops, 1) IS NULL THEN
    RAISE EXCEPTION 'Nenhum assignee do ClickUp tem operador cadastrado (clickup_user_id sem correspondência: %). Cadastre o operador antes de aplicar.', v_unmatched_ids;
  END IF;

  IF v_unmatched_ids IS NOT NULL AND array_length(v_unmatched_ids, 1) > 0 THEN
    RAISE EXCEPTION 'Assignee(s) do ClickUp sem operador cadastrado: %. Cadastre-os (ou corrija o clickup_user_id) antes de aplicar accept_clickup.', v_unmatched_ids;
  END IF;

  -- 3) Só agora, com o casamento 100% validado, substitui demand_operators.
  DELETE FROM portal.demand_operators WHERE demand_id = p_demand_id;

  INSERT INTO portal.demand_operators (demand_id, operator_id, role)
  SELECT p_demand_id, op_id, 'operator'
    FROM unnest(v_matched_ops) AS op_id
  ON CONFLICT DO NOTHING;

  UPDATE portal.demands
     SET clickup_assignee_sync = 'ok', clickup_assignee_detail = '{}'::jsonb
   WHERE id = p_demand_id;

  INSERT INTO portal.audit_log (event, user_id, identifier, metadata)
  SELECT 'demand_assignee_divergence_resolved',
         (SELECT id FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1),
         p_demand_id::text,
         -- array_length(vazio,1) devolve NULL, não 0 — coalesce para o audit_log não
         -- mentir sobre o caso pior (revisão 2026-09-03).
         jsonb_build_object('action', p_action, 'operators_applied', coalesce(array_length(v_matched_ops, 1), 0));

  RETURN jsonb_build_object('ok', true, 'action', p_action, 'demand_id', p_demand_id, 'operators_applied', coalesce(array_length(v_matched_ops, 1), 0));
END;
$function$;

-- ── Camada GRANT (motivo 2) ────────────────────────────────────────────────
-- Ordem importa: revogar de PUBLIC PRIMEIRO (é de lá que vem a herança), só
-- depois de anon. `CREATE OR REPLACE` preserva o ACL existente — sem estes
-- REVOKE a entrada `=X/postgres` continuaria viva mesmo após a substituição.
REVOKE ALL ON FUNCTION portal.admin_resolve_assignee_divergence(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal.admin_resolve_assignee_divergence(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION portal.admin_resolve_assignee_divergence(uuid, text) TO authenticated, service_role;

COMMIT;

-- ── Conferência pós-aplicação (rodar e colar o resultado) ──────────────────
-- ACL final esperado: SEM entrada começando por '=' (PUBLIC), sem anon.
--   SELECT p.proname, p.proacl::text
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'portal' AND p.proname = 'admin_resolve_assignee_divergence';
--
-- PUBLIC residual (entrada com grantee vazio) — tem que voltar VAZIO:
--   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'portal' AND p.proname = 'admin_resolve_assignee_divergence'
--      AND EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=%');
--   -- ⚠️ `proacl::text LIKE '%=X/%'` dá FALSO POSITIVO (casa 'postgres=X/'). Usar unnest.
--
-- anon não executa mais — tem que voltar `false`:
--   SELECT has_function_privilege('anon',
--     'portal.admin_resolve_assignee_divergence(uuid, text)', 'EXECUTE');
--
-- Sem sobrecarga acidental — tem que voltar EXATAMENTE 1 linha:
--   SELECT p.oid::regprocedure, pg_get_function_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'portal' AND p.proname = 'admin_resolve_assignee_divergence';
