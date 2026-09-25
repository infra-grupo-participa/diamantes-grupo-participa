-- 094_down — reversão da 094_admin_demand_operator_lock_order.
-- Uso: só em incidente/rollback deliberado. NÃO faz parte do fluxo numerado de
-- `supabase db push` — script avulso, rodar manualmente (psql/MCP) fora de uma
-- migration sequencial.
--
-- NÃO é destrutivo: só recria o corpo das duas funções na forma da 059 (sem o
-- PERFORM ... FOR UPDATE) e reafirma os grants nominais. Nenhuma coluna, índice
-- ou linha é tocada. `portal._resync_demand_assignees` não é tocada.
--
-- ⚠️ REVERTER ISTO REABRE O DEADLOCK 40P01. Sem o PERFORM, as duas funções voltam
-- a travar `demand_operators` sem antes travar `demands`, invertendo a ordem em
-- relação a `portal.apply_clickup_assignees` (091:106). Admin e webhook agindo na
-- mesma demanda ao mesmo tempo voltam a poder se matar. (O `net.http_post` de
-- `_resync_demand_assignees` é assíncrono — não estende a janela; ver 090:61-63.)
-- Só rode se o PERFORM for comprovadamente a causa de um incidente pior — não por
-- precaução.
--
-- 🔒 O QUE ESTE DOWN **NÃO** DESFAZ, DE PROPÓSITO: o REVOKE de PUBLIC/anon.
-- A 059 deixou `EXECUTE` para PUBLIC por DEFAULT do Postgres (função nova em
-- schema exposto nasce pública) — ela só fez `GRANT ... TO authenticated` em
-- 059:74-75, sem nenhum REVOKE. Isso não foi decisão de ninguém, foi o default.
-- Reabrir PUBLIC no rollback seria reintroduzir um buraco de segurança para
-- "restaurar" um estado que nunca foi intencional.
--
-- Portanto: este down restaura APENAS `authenticated` e `service_role`, os grants
-- nominais. NÃO existe `GRANT EXECUTE ... TO PUBLIC` aqui e não deve ser
-- adicionado. Mesma política do 093_down.sql. Os REVOKE são repetidos abaixo para
-- que o estado fechado sobreviva ao rollback independentemente da ordem em que os
-- scripts rodarem (`CREATE OR REPLACE` preserva o ACL, mas repetir torna o
-- resultado determinístico).
--
-- Nota: a 059 concedia só `authenticated` (059:74-75). Manter `service_role` aqui
-- é desvio consciente do estado original — service_role executava estas funções
-- por herança de PUBLIC; com PUBLIC fechado, remover o grant nominal quebraria
-- qualquer caminho de backend que dependa delas. É restauração de CAPACIDADE, não
-- de ACL literal. Mesmo critério adotado no 093_down.sql.
--
-- Assinaturas idênticas às da 094/059 — (p_demand_id uuid, p_operator_id uuid) nas
-- duas. Mudar a assinatura aqui criaria SOBRECARGA em vez de substituir, deixando
-- duas funções vivas e o chamador na versão errada.

BEGIN;

-- ── Corpo exato da 059 (sem o PERFORM ... FOR UPDATE) ──────────────────────

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
  DELETE FROM portal.demand_operators WHERE demand_id = p_demand_id AND operator_id = p_operator_id;
  v_removed := FOUND;
  IF v_removed THEN PERFORM portal._resync_demand_assignees(p_demand_id); END IF;
  RETURN jsonb_build_object('ok', true, 'removed', v_removed);
END;
$function$;

-- ── Permissões: mantém FECHADO. Não reabre PUBLIC (ver cabeçalho). ─────────
REVOKE ALL ON FUNCTION portal.admin_add_demand_operator(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal.admin_add_demand_operator(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION portal.admin_add_demand_operator(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION portal.admin_remove_demand_operator(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal.admin_remove_demand_operator(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION portal.admin_remove_demand_operator(uuid, uuid) TO authenticated, service_role;

-- Mantém fechada (mesma política): helper interno sem guard, chamado só por owner.
REVOKE ALL ON FUNCTION portal._resync_demand_assignees(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal._resync_demand_assignees(uuid) FROM anon;

COMMIT;

-- Conferência pós-rollback — o PERFORM tem que ter sumido das duas e o ACL
-- continuar fechado:
--   SELECT p.proname,
--          pg_get_functiondef(p.oid) LIKE '%FOR UPDATE%' AS ainda_tem_lock,
--          p.proacl::text
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'portal'
--      AND p.proname IN ('admin_add_demand_operator', 'admin_remove_demand_operator');
--   -- esperado: ainda_tem_lock = false nas duas; proacl SEM entrada começando por '='.
