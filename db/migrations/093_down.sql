-- 093_down — reversão da 093_admin_resolve_lock_order.
-- Uso: só em incidente/rollback deliberado. NÃO faz parte do fluxo numerado de
-- `supabase db push` — script avulso, rodar manualmente (psql/MCP) fora de uma
-- migration sequencial.
--
-- NÃO é destrutivo: só recria o corpo da função na forma da 086 (sem o PERFORM
-- ... FOR UPDATE) e reafirma os grants nominais. Nenhuma coluna, índice ou linha
-- é tocada.
--
-- ⚠️ REVERTER ISTO REABRE O DEADLOCK 40P01. Sem o PERFORM, a função volta a
-- travar `demand_operators` antes de `demands`, invertendo a ordem em relação a
-- `portal.apply_clickup_assignees` (091:106). Admin e webhook agindo na mesma
-- demanda ao mesmo tempo voltam a poder se matar. Só rode se o PERFORM for
-- comprovadamente a causa de um incidente pior — não por precaução.
--
-- 🔒 O QUE ESTE DOWN **NÃO** DESFAZ, DE PROPÓSITO: o REVOKE de PUBLIC/anon.
-- A 086 deixou `EXECUTE` para PUBLIC por DEFAULT do Postgres (função nova em
-- schema exposto nasce pública), não por decisão de ninguém. `proacl` medido em
-- produção em 24/09: {=X/postgres, postgres=X, service_role=X, authenticated=X}.
-- Reabrir PUBLIC no rollback seria reintroduzir um buraco de segurança para
-- "restaurar" um estado que nunca foi intencional.
--
-- Portanto: este down restaura APENAS `authenticated` e `service_role`, os
-- grants nominais. NÃO existe `GRANT EXECUTE ... TO PUBLIC` aqui e não deve ser
-- adicionado. Os REVOKE são repetidos abaixo para garantir que o estado fechado
-- sobreviva ao rollback (`CREATE OR REPLACE` preserva o ACL, mas repetir torna o
-- resultado independente da ordem em que os scripts rodarem).
--
-- Nota: a 086 concedia só `authenticated` (086:291). Manter `service_role` aqui é
-- desvio consciente do estado original — service_role já executava a função por
-- herança de PUBLIC, e o backend depende disso; remover o grant nominal enquanto
-- PUBLIC está fechado quebraria o caminho do service_role. É restauração de
-- CAPACIDADE, não de ACL literal.
--
-- Assinatura idêntica à da 093/086 — (p_demand_id uuid, p_action text). Mudar a
-- assinatura aqui criaria SOBRECARGA em vez de substituir, deixando duas funções
-- vivas e o chamador na versão errada.

BEGIN;

-- ── Corpo exato da 086 (sem o PERFORM ... FOR UPDATE) ──────────────────────
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

-- ── Permissões: mantém FECHADO. Não reabre PUBLIC (ver cabeçalho). ─────────
REVOKE ALL ON FUNCTION portal.admin_resolve_assignee_divergence(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal.admin_resolve_assignee_divergence(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION portal.admin_resolve_assignee_divergence(uuid, text) TO authenticated, service_role;

COMMIT;

-- Conferência pós-rollback — o PERFORM tem que ter sumido e o ACL continuar fechado:
--   SELECT pg_get_functiondef(p.oid) LIKE '%FOR UPDATE%' AS ainda_tem_lock, p.proacl::text
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'portal' AND p.proname = 'admin_resolve_assignee_divergence';
--   -- esperado: ainda_tem_lock = false; proacl SEM entrada começando por '='.
