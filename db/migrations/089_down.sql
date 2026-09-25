-- 089_down — reverte 089_external_split
--
-- Volta ao estado da 086: um único rótulo 'external' e o índice parcial cobrindo
-- ('partial','none','external').
--
-- ⚠️ REVERSÃO COM PERDA: os três estados novos colapsam de volta num só. A distinção
-- perda × troca × reforço é DERIVADA no momento do evento (webhook comparando missing
-- e extra) e não é recuperável depois — reaplicar a 089 não restaura a classificação
-- destas linhas por igual, porque o backfill da 089 depende de
-- clickup_assignee_detail.after/before continuarem lá. As chaves missing_names/
-- extra_names gravadas pela 089 são DEIXADAS no jsonb de propósito: são informação
-- extra que o painel antigo simplesmente ignora, e apagá-las destruiria o único
-- registro de quem saiu/entrou. Reverter o CÓDIGO (edge v14 + PENDING_ASSIGNEE_STATES
-- com 'external') é obrigatório junto — rodar só este SQL deixa o webhook v15
-- gravando 'external_loss' num índice que não cobre esse valor: Seq Scan silencioso.
--
-- ORDEM: reclassifica primeiro, índice depois. O índice novo cobre 'external_loss';
-- se o índice fosse trocado antes do UPDATE, as linhas em external_loss sairiam do
-- índice durante a janela — irrelevante em 29 linhas, mas a ordem correta é grátis.

-- 1. Colapsa os três estados de volta em 'external'.
UPDATE portal.demands
   SET clickup_assignee_sync = 'external'
 WHERE clickup_assignee_sync LIKE 'external%'
   AND clickup_assignee_sync <> 'external';

-- 2. Restaura o índice parcial da 086, com a lista literal original.
DROP INDEX IF EXISTS portal.idx_demands_assignee_pending;

CREATE INDEX idx_demands_assignee_pending
  ON portal.demands (created_at DESC)
  WHERE clickup_assignee_sync IN ('partial', 'none', 'external');

-- 3. COMMENTs voltam ao texto da 086/087.
COMMENT ON COLUMN portal.demands.clickup_assignee_sync IS
  'Estado da última comparação portal vs ClickUp para os assignees da task (RESUMO
   derivado, para badge do painel — o detalhe por operador vive em
   demand_operators.clickup_delivery). Valores esperados (sem enforcement — divergência
   inesperada deve gravar, não falhar):
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
  '| no_clickup_user | stale_clickup_user | unknown_rejected), ou { before: [nomes], after: '
  '[{id,name}] } para "external" (só webhook). Consumido só pelo painel admin.';

COMMENT ON COLUMN portal.operators.clickup_notifiable IS
  'false = operador é GUEST no ClickUp (não pode ser assignee nem watcher — ITEM_087/
   ITEM_096, descartado em silêncio pelo ClickUp quando misturado com member). Mantido
   pela reconciliação (clickup-sync, a partir de guest_clickup_ids_cache) — não editar
   à mão fora de teste. Quando false, send-email notifica o operador por e-mail com o
   link da task (ele não vai saber pelo ClickUp).';
