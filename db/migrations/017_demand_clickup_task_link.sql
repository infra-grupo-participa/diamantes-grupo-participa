-- ============================================================================
-- 017_demand_clickup_task_link.sql
-- Garante coluna clickup_task_id em portal.demands + índice de busca.
-- Também adiciona coluna clickup_comment_sync para rastrear último sync.
-- ============================================================================

ALTER TABLE portal.demands
  ADD COLUMN IF NOT EXISTS clickup_task_id   text,
  ADD COLUMN IF NOT EXISTS clickup_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_demands_clickup_task_id
  ON portal.demands(clickup_task_id)
  WHERE clickup_task_id IS NOT NULL;

COMMENT ON COLUMN portal.demands.clickup_task_id IS
  'ID da task no ClickUp correspondente a esta demanda.';
COMMENT ON COLUMN portal.demands.clickup_synced_at IS
  'Última vez que uma mensagem do cliente foi enviada como comentário no ClickUp.';

-- ============================================================================
-- Fim 017_demand_clickup_task_link.sql
-- ============================================================================
