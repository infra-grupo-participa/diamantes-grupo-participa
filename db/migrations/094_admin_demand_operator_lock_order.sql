-- 094_admin_demand_operator_lock_order — fecha a pendência da 059 listada no
-- cabeçalho da 093: ordem de lock + camada GRANT nas duas RPCs de gestão manual
-- de operadores.
--
-- Origem: pendência registrada em db/migrations/093_admin_resolve_lock_order.sql:43-60,
-- derivada do achado do kirad de 24/09/2026 (re-auditoria da 091). A 093 corrigiu
-- só a `admin_resolve_assignee_divergence` (086); estas duas ficaram de fora por
-- escopo. Esta migration aplica a MESMA regra a elas.
--
-- ── MOTIVO 1: DEADLOCK 40P01 POR ORDEM DE LOCK INVERTIDA ────────────────────
-- As duas funções da 059 escrevem em `portal.demand_operators` SEM travar antes a
-- linha de `portal.demands`:
--
--   db/migrations/059_admin_manage_demand_operators.sql:45
--     portal.admin_add_demand_operator → INSERT INTO portal.demand_operators
--     A linha 059:41 faz apenas:
--       IF NOT EXISTS (SELECT 1 FROM portal.demands WHERE id = p_demand_id) THEN ...
--     Teste de EXISTÊNCIA, sem FOR UPDATE — não adquire lock nenhum. Lê o snapshot
--     e segue. A primeira (e única) linha travada é a de demand_operators.
--
--   db/migrations/059_admin_manage_demand_operators.sql:67
--     portal.admin_remove_demand_operator → DELETE FROM portal.demand_operators
--     Não lê `demands` em momento nenhum.
--
-- Confirmado na 059: `grep -n "FOR UPDATE" db/migrations/059_*.sql` → zero ocorrências.
--
-- Do outro lado, `portal.apply_clickup_assignees` (091, caminho do WEBHOOK) faz:
--     091:106  PERFORM 1 FROM portal.demands WHERE id = p_demand_id FOR UPDATE;
--     091:164  INSERT INTO portal.demand_operators ...
--     091:178  DELETE FROM portal.demand_operators ...
--   → `demands` PRIMEIRO, depois `demand_operators`.
--
-- Ordens opostas nas mesmas duas tabelas. Com admin e webhook agindo na MESMA
-- demanda ao mesmo tempo:
--   T_admin   segura a(s) linha(s) de demand_operators e — via
--             _resync_demand_assignees / caminho de escrita — espera demands;
--   T_webhook segura a linha de demands e espera as de demand_operators.
-- Espera cruzada → `deadlock detected` (40P01); o Postgres mata uma das duas.
--
-- Nota sobre `_resync_demand_assignees` (059:52 e 059:69), chamada ANTES do commit:
-- ela dispara `net.http_post` para a edge `clickup-sync`, e o pg_net é ASSÍNCRONO —
-- enfileira e retorna na hora (o `timeout_milliseconds := 5000` é do worker do pg_net
-- esperando a RESPOSTA, fora da transação chamadora; ver 090:61-63). A transação
-- segura os locks só pelo tempo do INSERT/DELETE + enfileiramento: milissegundos.
-- Não há espera de rede sob lock (corrigido em 24/09 após revisão do kirad — a
-- versão anterior deste comentário afirmava o contrário).
--
-- Correção: mesma da 093 — travar a linha de `demands` ANTES de qualquer leitura
-- ou escrita, na mesma forma textual da 091:106 e da 093:113.
--
-- ⚠️ O PERFORM vem logo após o guard de admin e ANTES do
-- `IF NOT EXISTS (SELECT 1 FROM portal.demands ...)` da 059:41. Travar depois de
-- ler é não travar. O `IF NOT EXISTS` é MANTIDO como está (não virou
-- `... FOR UPDATE`): ele continua sendo o responsável pela mensagem de erro
-- 'Demanda não encontrada.', e o ponto aqui é a ORDEM de aquisição de lock entre
-- as duas tabelas — não a forma do teste de existência.
--
-- 📌 REGRA PERMANENTE (a mesma declarada na 093):
--    TODA função que escreve em portal.demand_operators trava a linha de
--    portal.demands com FOR UPDATE ANTES, sem exceção:
--        PERFORM 1 FROM portal.demands WHERE id = <demanda> FOR UPDATE;
--    `demands` → `demand_operators`. Nunca o inverso.
--
-- Com esta migration, os caminhos conhecidos que escrevem em demand_operators e
-- competem com o webhook passam a seguir a regra:
--    091 apply_clickup_assignees .............. já conforme (091:106)
--    086 admin_resolve_assignee_divergence .... corrigida na 093
--    059 admin_add_demand_operator ............ corrigida AQUI
--    059 admin_remove_demand_operator ......... corrigida AQUI
--
-- ── MOTIVO 2: EXECUTE PARA PUBLIC (camada GRANT faltando) ──────────────────
-- `grep -n "GRANT\|REVOKE" db/migrations/059_admin_manage_demand_operators.sql`
-- devolve EXATAMENTE duas linhas, ambas GRANT, nenhum REVOKE:
--     059:74  GRANT EXECUTE ON FUNCTION portal.admin_add_demand_operator(uuid, uuid) TO authenticated;
--     059:75  GRANT EXECUTE ON FUNCTION portal.admin_remove_demand_operator(uuid, uuid) TO authenticated;
--
-- Mesmo padrão da 086 (que fez só `GRANT ... TO authenticated` em 086:291 e teve
-- `proacl` medido em produção como {=X/postgres, postgres=X, service_role=X,
-- authenticated=X}). Função nova em schema exposto NASCE com EXECUTE para PUBLIC;
-- o GRANT nominal SOMA ao default, não substitui. Sem REVOKE, a entrada de PUBLIC
-- (`=X/postgres` — grantee vazio antes do `=`) continua no ACL, e toda role herda
-- de PUBLIC → `anon` executa.
--
-- ⚠️ NÃO medi o `proacl` destas duas em produção (sem credencial). A conclusão vem
-- do texto da 059: ausência de REVOKE + default do Postgres. Confirmar com a query
-- do rodapé ao aplicar — se o ACL já vier fechado, os REVOKE são no-op inofensivo.
--
-- ⚠️ `REVOKE ... FROM anon` NÃO resolve sozinho quando a permissão vem de PUBLIC:
-- executa sem erro e sem efeito, porque `anon` não tem grant próprio — herda. O
-- revoke que importa é o de PUBLIC. Mantemos os dois: PUBLIC corta a herança, anon
-- cobre um grant nominal dado fora de migration.
--
-- O GRANT é camada ADICIONAL, não substituta: o `IF NOT portal.is_admin() THEN
-- RAISE 42501` na 1ª linha de cada corpo continua sendo a barreira de AUTORIZAÇÃO
-- (`authenticated` inclui todo usuário logado do portal, não só admin). Defesa em
-- profundidade.
--
-- ── ESCOPO ──────────────────────────────────────────────────────────────────
-- Corpo IDÊNTICO ao da 059 em ambas as funções, mais UMA linha cada (o PERFORM).
-- Assinaturas idênticas — (p_demand_id uuid, p_operator_id uuid) nas duas — porque
-- `CREATE OR REPLACE` com assinatura diferente CRIA SOBRECARGA em vez de
-- substituir, e o chamador antigo continuaria caindo na versão sem lock.
-- `portal._resync_demand_assignees` NÃO é tocada por esta migration.
-- Reversão: db/migrations/094_down.sql

BEGIN;

-- Adicionar operador à demanda.
CREATE OR REPLACE FUNCTION portal.admin_add_demand_operator(p_demand_id uuid, p_operator_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public'
AS $function$
DECLARE v_added boolean := false;
BEGIN
  IF NOT portal.is_admin() THEN RAISE EXCEPTION 'Apenas admin pode gerir operadores.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM portal.demands WHERE id = p_demand_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM portal.demands WHERE id = p_demand_id) THEN RAISE EXCEPTION 'Demanda não encontrada.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM portal.operators WHERE id = p_operator_id) THEN RAISE EXCEPTION 'Operador não encontrado.'; END IF;

  INSERT INTO portal.demand_operators (demand_id, operator_id, role)
  SELECT p_demand_id, p_operator_id, 'operator'
  WHERE NOT EXISTS (
    SELECT 1 FROM portal.demand_operators WHERE demand_id = p_demand_id AND operator_id = p_operator_id
  );
  v_added := FOUND;

  IF v_added THEN PERFORM portal._resync_demand_assignees(p_demand_id); END IF;
  RETURN jsonb_build_object('ok', true, 'added', v_added);
END;
$function$;

-- Remover operador da demanda.
CREATE OR REPLACE FUNCTION portal.admin_remove_demand_operator(p_demand_id uuid, p_operator_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public'
AS $function$
DECLARE v_removed boolean := false;
BEGIN
  IF NOT portal.is_admin() THEN RAISE EXCEPTION 'Apenas admin pode gerir operadores.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM portal.demands WHERE id = p_demand_id FOR UPDATE;
  DELETE FROM portal.demand_operators WHERE demand_id = p_demand_id AND operator_id = p_operator_id;
  v_removed := FOUND;
  IF v_removed THEN PERFORM portal._resync_demand_assignees(p_demand_id); END IF;
  RETURN jsonb_build_object('ok', true, 'removed', v_removed);
END;
$function$;

-- ── Camada GRANT (motivo 2) ────────────────────────────────────────────────
-- Ordem importa: revogar de PUBLIC PRIMEIRO (é de lá que vem a herança), só
-- depois de anon. `CREATE OR REPLACE` preserva o ACL existente — sem estes REVOKE
-- a entrada de PUBLIC continuaria viva mesmo após a substituição do corpo.
REVOKE ALL ON FUNCTION portal.admin_add_demand_operator(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal.admin_add_demand_operator(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION portal.admin_add_demand_operator(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION portal.admin_remove_demand_operator(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal.admin_remove_demand_operator(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION portal.admin_remove_demand_operator(uuid, uuid) TO authenticated, service_role;

-- `_resync_demand_assignees` é helper INTERNO (chamado só de dentro de funções
-- SECURITY DEFINER: 059:52, 059:69, 086:218, 093:124) e NÃO tem guard is_admin() no
-- corpo — o GRANT é a única tranca. proacl medido em 24/09/2026:
-- {=X/postgres, postgres=X, service_role=X} → EXECUTE para PUBLIC via PostgREST
-- (anon poderia enfileirar resync de qualquer demanda). Fecha-se sem GRANT novo:
-- os chamadores rodam como owner; service_role já tem grant nominal.
REVOKE ALL ON FUNCTION portal._resync_demand_assignees(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal._resync_demand_assignees(uuid) FROM anon;

COMMIT;

-- ── Conferência pós-aplicação (rodar e colar o resultado) ──────────────────
-- ACL final esperado nas DUAS: SEM entrada começando por '=' (PUBLIC), sem anon.
--   SELECT p.proname, p.proacl::text
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'portal'
--      AND p.proname IN ('admin_add_demand_operator', 'admin_remove_demand_operator');
--
-- PUBLIC residual (entrada com grantee vazio) — tem que voltar VAZIO:
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'portal'
--      AND p.proname IN ('admin_add_demand_operator', 'admin_remove_demand_operator')
--      AND EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=%');
--   -- ⚠️ `proacl::text LIKE '%=X/%'` dá FALSO POSITIVO (casa 'postgres=X/'). Usar unnest.
--
-- anon não executa mais — as duas têm que voltar `false`:
--   SELECT has_function_privilege('anon', 'portal.admin_add_demand_operator(uuid, uuid)', 'EXECUTE'),
--          has_function_privilege('anon', 'portal.admin_remove_demand_operator(uuid, uuid)', 'EXECUTE');
--
-- Sem sobrecarga acidental — tem que voltar EXATAMENTE 2 linhas (uma por função):
--   SELECT p.oid::regprocedure, pg_get_function_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'portal'
--      AND p.proname IN ('admin_add_demand_operator', 'admin_remove_demand_operator');
--
-- Lock presente nas duas — as duas têm que voltar `true`:
--   SELECT p.proname, pg_get_functiondef(p.oid) LIKE '%FOR UPDATE%' AS tem_lock
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'portal'
--      AND p.proname IN ('admin_add_demand_operator', 'admin_remove_demand_operator');
