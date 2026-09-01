-- 086_demand_assignee_sync_state
-- Fecha o gap "portal manda N assignees mas o ClickUp aceita menos" — hoje 9 de 15
-- demandas com clickup_task_id divergem. Este lote NÃO resolve as divergências em
-- massa — só cria o estado para o admin decidir caso a caso pelo painel (decisão do
-- Marcio: webhook observa e registra, nunca escreve em demand_operators sozinho).
--
-- REVISÃO 2026-09-01 (pós-teste real na API, ver clickup-sync v13): multiple_assignees
-- já está LIGADO no espaço 901313801473 — a causa real da divergência não é capability
-- do espaço, é que 2 operadores (Caio Marcondes, Manuela Rios) são GUEST no ClickUp
-- (decisão do Marcio: manter guest, não converter) e guest não pode ser assignee. Pior:
-- quando a lista mistura member+guest, o ClickUp aceita com HTTP 200 e descarta o guest
-- em SILÊNCIO — por isso a detecção é por comparação pós-resposta (request vs
-- task.assignees devolvido), não por captura de exceção.
--
-- Aplicar via MCP: apply_migration name=086_demand_assignee_sync_state
-- Esta cópia em arquivo é a fonte da verdade versionada.

-- ── A1: estado de sincronização de assignees por demanda ──────────────────
-- Sem check constraint rígido de propósito: um valor inesperado tem que
-- GRAVAR (e aparecer no painel para investigação), nunca derrubar a sync.
ALTER TABLE portal.demands
  ADD COLUMN IF NOT EXISTS clickup_assignee_sync text,
  ADD COLUMN IF NOT EXISTS clickup_assignee_detail jsonb NOT NULL DEFAULT '{}';

COMMENT ON COLUMN portal.demands.clickup_assignee_sync IS
  'Estado da última comparação portal vs ClickUp para os assignees da task. '
  'Valores esperados (sem enforcement — divergência inesperada deve gravar, não falhar):
   ok               = todos os operadores da demanda estão como assignee no ClickUp
                       (ou task sem clickup_task_id ainda);
   partial          = 1+ operador esperado ficou de fora da task por causa NÃO-permanente
                       (ex.: espaço temporariamente single-assignee) — acionável pelo admin;
   partial_expected = 1+ operador ficou de fora e a causa é 100% GUEST (clickup_assignee_detail
                       .permanent=true) — ESTADO ESPERADO enquanto a decisão for manter guest,
                       não é falha a corrigir. Alerta por e-mail dispara só na 1ª detecção.
   none             = nenhum operador esperado da demanda está como assignee no ClickUp;
   external         = o ClickUp tem assignee(s) que o portal não reconhece nesta demanda (mudança
                       feita direto no ClickUp, fora do portal) — populado só pelo webhook
                       (taskAssigneeUpdated), nunca pelo sync de saída.
   Não existe mais watcher como fallback: POST /task/{id}/watcher não existe na API v2 do
   ClickUp, e guest não pode ser watcher (ITEM_096) nem assignee (ITEM_087/descarte silencioso).';

COMMENT ON COLUMN portal.demands.clickup_assignee_detail IS
  'Detalhe da última comparação de assignees (jsonb, default {}). Formato livre por estado — '
  'tipicamente { sent: [nomes], missing: [{name, clickup_user_id, reason}], permanent: bool } '
  'para "partial"/"partial_expected"/"none" (reason ∈ guest_cannot_assign | space_single_assignee '
  '| unknown_rejected), ou { before: [nomes], after: [{id,name}] } para "external" (só webhook). '
  'Consumido só pelo painel admin.';

-- ── A2: expõe as 2 colunas novas em v_demands ──────────────────────────────
-- View muda de colunas → exige DROP + CREATE (CREATE OR REPLACE não permite
-- adicionar coluna no meio/fim com mesma ordem seguro aqui porque há SELECTs
-- explícitos no app; seguimos o padrão já usado na 077). Definição-base copiada
-- da versão vigente em 077_auditoria_integracao_fixes.sql, só com as 2 colunas
-- novas acrescentadas ao final do SELECT.
DROP VIEW IF EXISTS portal.v_demands;
CREATE VIEW portal.v_demands AS
 SELECT d.id, d.client_slug, c.display_name AS client_name, d.title, d.description,
    d.status, d.starts_at, d.ends_at, d.clickup_task_id, d.finalized_at, d.created_at,
    d.updated_at, d.service_type, d.briefing_status,
    (SELECT u.name FROM portal.users u WHERE u.id = d.created_by) AS created_by_name,
    (SELECT count(*) FROM portal.demand_operators dop WHERE dop.demand_id = d.id) AS operators_total,
    (SELECT count(*) FROM portal.demand_messages dmsg WHERE dmsg.demand_id = d.id) AS messages_count,
    (SELECT max(dmsg2.created_at) FROM portal.demand_messages dmsg2 WHERE dmsg2.demand_id = d.id) AS last_message_at,
    d.project_id,
    (SELECT p.title FROM portal.projects p WHERE p.id = d.project_id) AS project_title,
    (SELECT dmsg3.content FROM portal.demand_messages dmsg3 WHERE dmsg3.demand_id = d.id ORDER BY dmsg3.created_at DESC LIMIT 1) AS last_message_preview,
    (SELECT CASE WHEN u3.role IS NULL OR u3.role <> 'user' THEN 'team' ELSE 'client' END
       FROM portal.demand_messages dmsg4 LEFT JOIN portal.users u3 ON u3.id = dmsg4.user_id
      WHERE dmsg4.demand_id = d.id ORDER BY dmsg4.created_at DESC LIMIT 1) AS last_message_from,
    d.clickup_assignee_sync,
    d.clickup_assignee_detail
   FROM portal.demands d
   JOIN portal.clients c ON c.slug = d.client_slug;
GRANT SELECT ON portal.v_demands TO authenticated, service_role;

-- ── A3: chaves de configuração para a estratégia de assignees ─────────────
-- assignee_strategy: 'auto' manda todos os assignees e reconcilia o estado real
-- por comparação pós-resposta (comportamento novo). 'legacy' pula a reconciliação
-- e volta ao comportamento anterior a este lote — é a reversão.
-- space_multi_assignee_cache: cache do GET /space (multiple_assignees) com TTL de
-- 1h, para não bater no ClickUp a cada createTask/updateTask.
-- guest_clickup_ids_cache: cache do GET /team (user.role=4 → guest) com TTL de 1h,
-- usado só para CLASSIFICAR a causa de um assignee ausente (nunca para decidir o
-- que mandar — o portal sempre tenta mandar todos; o ClickUp decide quem aceita).
INSERT INTO portal.clickup_config (key, value)
VALUES ('assignee_strategy', 'auto')
ON CONFLICT (key) DO NOTHING;

INSERT INTO portal.clickup_config (key, value)
VALUES ('space_multi_assignee_cache', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO portal.clickup_config (key, value)
VALUES ('guest_clickup_ids_cache', '')
ON CONFLICT (key) DO NOTHING;

-- ── A4: RPC de resolução manual de divergência (admin) ─────────────────────
-- 'reapply'       → reaplica o estado do portal no ClickUp (reusa
--                    portal._resync_demand_assignees, já existe desde a 059).
-- 'accept_clickup' → reescreve demand_operators a partir do que está REAL no
--                    ClickUp hoje (clickup_assignee_detail.after, se existir —
--                    fallback: assignees atuais da task via clickup-sync). Ação
--                    manual e explícita do admin — só ela pode alterar
--                    demand_operators a partir do ClickUp (decisão do Marcio).
-- 'dismiss'        → marca a divergência como revisada (limpa o estado para
--                    'ok' sem mudar nada), para tirar do radar sem reaplicar. Serve
--                    também para 'partial_expected' (guest) quando o admin já sabe
--                    e só quer silenciar aquela demanda pontual — o alerta por e-mail
--                    já só dispara na 1ª detecção, então 'dismiss' aqui é raramente
--                    necessário, mas fica disponível.
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
  v_op record;
  v_matched uuid[];
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

  DELETE FROM portal.demand_operators WHERE demand_id = p_demand_id;

  v_matched := ARRAY[]::uuid[];
  FOR v_op IN
    SELECT o.id
      FROM portal.operators o
     WHERE o.clickup_user_id IN (
       SELECT (elem ->> 'id') FROM jsonb_array_elements(v_after) AS elem WHERE elem ->> 'id' IS NOT NULL
     )
  LOOP
    INSERT INTO portal.demand_operators (demand_id, operator_id, role)
    VALUES (p_demand_id, v_op.id, 'operator')
    ON CONFLICT DO NOTHING;
    v_matched := v_matched || v_op.id;
  END LOOP;

  UPDATE portal.demands
     SET clickup_assignee_sync = 'ok', clickup_assignee_detail = '{}'::jsonb
   WHERE id = p_demand_id;

  INSERT INTO portal.audit_log (event, user_id, identifier, metadata)
  SELECT 'demand_assignee_divergence_resolved',
         (SELECT id FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1),
         p_demand_id::text,
         jsonb_build_object('action', p_action, 'operators_applied', array_length(v_matched, 1));

  RETURN jsonb_build_object('ok', true, 'action', p_action, 'demand_id', p_demand_id, 'operators_applied', array_length(v_matched, 1));
END;
$function$;

-- Função nova em schema exposto nasce pública — GRANT explícito só para authenticated.
GRANT EXECUTE ON FUNCTION portal.admin_resolve_assignee_divergence(uuid, text) TO authenticated;
