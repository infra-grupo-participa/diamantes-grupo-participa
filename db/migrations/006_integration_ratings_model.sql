-- ============================================================================
-- 006_integration_ratings_model.sql
-- Modelo de dados de avaliações bidirecionais + histórico de status + pontos.
-- ----------------------------------------------------------------------------
-- Esta migration é apenas estrutura. RPCs ficam na FB, triggers na FC.
-- ----------------------------------------------------------------------------
-- Decisões alinhadas:
--   - task_id mantido em ratings (denormalização legacy)
--   - Escala de pontos A (aplicada na FC): 9-10=+30, 7-8=+15, 5-6=+5
--   - Auto-close de avaliação após 7 dias (cron na FC)
-- ============================================================================

-- ============================================================================
-- 1) ratings: vincular à demanda + status de submissão
-- ----------------------------------------------------------------------------
-- demand_id é nullable: as 20 ratings legacy referenciam tasks ClickUp que
-- nunca foram importadas como demands.
-- status: 'pending' (placeholder ao fechar demanda) → 'submitted' (cliente
--   avaliou) ou 'expired' (7d sem resposta).
-- task_id passa a ser nullable (em demandas criadas no portal, sem ClickUp,
--   não há task_id).
-- ============================================================================

ALTER TABLE portal.ratings
  ADD COLUMN IF NOT EXISTS demand_id    uuid REFERENCES portal.demands(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('pending', 'submitted', 'expired')),
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- Backfill: liga ratings históricas a demandas se houver clickup_task_id match
UPDATE portal.ratings r
SET demand_id = d.id
FROM portal.demands d
WHERE r.task_id = d.clickup_task_id
  AND r.demand_id IS NULL;

-- Ratings legacy (20 existentes vieram do ClickUp direto) já estão submitted
UPDATE portal.ratings
SET submitted_at = COALESCE(submitted_at, created_at)
WHERE status = 'submitted' AND submitted_at IS NULL;

ALTER TABLE portal.ratings ALTER COLUMN task_id DROP NOT NULL;

-- Score check já existia (1..10). Validar comment opcional (já é nullable).

CREATE INDEX IF NOT EXISTS idx_ratings_demand_id ON portal.ratings(demand_id) WHERE demand_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ratings_user_id   ON portal.ratings(user_id)   WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ratings_status    ON portal.ratings(status);

COMMENT ON COLUMN portal.ratings.demand_id   IS 'FK forte para demands. Substitui task_id como link primário. NULL apenas em ratings legacy do ClickUp.';
COMMENT ON COLUMN portal.ratings.status      IS 'pending: placeholder criado ao fechar demanda. submitted: cliente avaliou. expired: 7d sem resposta (auto-close).';
COMMENT ON COLUMN portal.ratings.submitted_at IS 'Quando o cliente efetivamente enviou a avaliação. Diferente de created_at para placeholders pending.';

-- ============================================================================
-- 2) operator_to_client_ratings: avaliação reversa (operador → cliente)
-- ----------------------------------------------------------------------------
-- Escala 1..5 (mais simples que 1..10 do cliente — decisão de UX).
-- dimensions: jsonb {communication, clarity, payment_punctuality} sem schema
-- rígido pra permitir crescer no futuro.
-- UNIQUE(demand_id, operator_id): cada operador avalia o cliente UMA vez por
-- demanda.
-- ============================================================================

CREATE TABLE IF NOT EXISTS portal.operator_to_client_ratings (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id     uuid          NOT NULL REFERENCES portal.demands(id) ON DELETE CASCADE,
  operator_id   uuid          NOT NULL REFERENCES portal.users(id)   ON DELETE CASCADE,
  client_slug   text          NOT NULL REFERENCES portal.clients(slug) ON DELETE CASCADE,
  score         smallint      NOT NULL CHECK (score >= 1 AND score <= 5),
  comment       text,
  dimensions    jsonb         NOT NULL DEFAULT '{}'::jsonb,
  status        text          NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('pending', 'submitted', 'expired')),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  submitted_at  timestamptz,
  UNIQUE (demand_id, operator_id)
);

CREATE INDEX IF NOT EXISTS idx_op_client_rat_client   ON portal.operator_to_client_ratings(client_slug);
CREATE INDEX IF NOT EXISTS idx_op_client_rat_operator ON portal.operator_to_client_ratings(operator_id);
CREATE INDEX IF NOT EXISTS idx_op_client_rat_status   ON portal.operator_to_client_ratings(status);

ALTER TABLE portal.operator_to_client_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "op_rat_self_select" ON portal.operator_to_client_ratings;
CREATE POLICY "op_rat_self_select" ON portal.operator_to_client_ratings
  FOR SELECT TO authenticated
  USING (
    operator_id = (SELECT id FROM portal.users WHERE auth_user_id = auth.uid())
    OR portal.is_admin()
  );

DROP POLICY IF EXISTS "op_rat_self_update" ON portal.operator_to_client_ratings;
CREATE POLICY "op_rat_self_update" ON portal.operator_to_client_ratings
  FOR UPDATE TO authenticated
  USING (
    operator_id = (SELECT id FROM portal.users WHERE auth_user_id = auth.uid())
    AND status = 'pending'
  )
  WITH CHECK (
    operator_id = (SELECT id FROM portal.users WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "op_rat_admin_all" ON portal.operator_to_client_ratings;
CREATE POLICY "op_rat_admin_all" ON portal.operator_to_client_ratings
  FOR ALL TO authenticated
  USING (portal.is_admin())
  WITH CHECK (portal.is_admin());

GRANT SELECT, UPDATE ON portal.operator_to_client_ratings TO authenticated;

COMMENT ON TABLE  portal.operator_to_client_ratings IS 'Avaliação do operador sobre o cliente após demanda done. Bidirecionalidade complementar a portal.ratings (cliente→operador).';
COMMENT ON COLUMN portal.operator_to_client_ratings.dimensions IS 'Avaliações granulares: {"communication": 4, "clarity": 5, "payment_punctuality": 3}. Schemaless por design.';

-- ============================================================================
-- 3) demand_status_log: histórico de transições de status
-- ----------------------------------------------------------------------------
-- Append-only. Trigger (FC) popula automaticamente em UPDATE de demands.status.
-- ============================================================================

CREATE TABLE IF NOT EXISTS portal.demand_status_log (
  id          bigserial      PRIMARY KEY,
  demand_id   uuid           NOT NULL REFERENCES portal.demands(id) ON DELETE CASCADE,
  from_status text,
  to_status   text           NOT NULL,
  by_user_id  uuid           REFERENCES portal.users(id),
  changed_at  timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_log_demand    ON portal.demand_status_log(demand_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_log_to_status ON portal.demand_status_log(to_status);

ALTER TABLE portal.demand_status_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "status_log_select_if_access" ON portal.demand_status_log;
CREATE POLICY "status_log_select_if_access" ON portal.demand_status_log
  FOR SELECT TO authenticated
  USING (portal.can_access_demand(demand_id));

DROP POLICY IF EXISTS "status_log_admin_all" ON portal.demand_status_log;
CREATE POLICY "status_log_admin_all" ON portal.demand_status_log
  FOR ALL TO authenticated
  USING (portal.is_admin())
  WITH CHECK (portal.is_admin());

GRANT SELECT ON portal.demand_status_log TO authenticated;

COMMENT ON TABLE portal.demand_status_log IS 'Append-only: cada transição de demands.status gera uma linha. Trigger trg_demand_status_log (FC) popula automaticamente.';

-- ============================================================================
-- 4) operator_points: log de pontos por operador
-- ----------------------------------------------------------------------------
-- Append-only. Trigger (FC) popula quando ratings.submitted_at é setado.
-- ============================================================================

CREATE TABLE IF NOT EXISTS portal.operator_points (
  id          bigserial      PRIMARY KEY,
  user_id     uuid           NOT NULL REFERENCES portal.users(id)   ON DELETE CASCADE,
  demand_id   uuid           REFERENCES portal.demands(id)          ON DELETE SET NULL,
  rating_id   uuid           REFERENCES portal.ratings(id)          ON DELETE SET NULL,
  points      integer        NOT NULL,
  reason      text           NOT NULL,
  created_at  timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_op_points_user   ON portal.operator_points(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_op_points_demand ON portal.operator_points(demand_id) WHERE demand_id IS NOT NULL;

ALTER TABLE portal.operator_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "op_points_self_select" ON portal.operator_points;
CREATE POLICY "op_points_self_select" ON portal.operator_points
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT id FROM portal.users WHERE auth_user_id = auth.uid())
    OR portal.is_admin()
  );

DROP POLICY IF EXISTS "op_points_admin_all" ON portal.operator_points;
CREATE POLICY "op_points_admin_all" ON portal.operator_points
  FOR ALL TO authenticated
  USING (portal.is_admin())
  WITH CHECK (portal.is_admin());

GRANT SELECT ON portal.operator_points TO authenticated;

COMMENT ON TABLE portal.operator_points IS 'Log de pontos por operador. Append-only. Trigger trg_award_points (FC) gera linhas a partir de ratings submitted.';

-- ============================================================================
-- 5) users.points_score — cache agregado
-- ----------------------------------------------------------------------------
-- Calculado pelo trigger trg_award_points (FC). Evita SUM em toda consulta de
-- dashboard. Pode ser recalibrado a qualquer momento via UPDATE users SET
-- points_score = (SELECT COALESCE(SUM(points),0) FROM operator_points WHERE
-- user_id = users.id).
-- ============================================================================

ALTER TABLE portal.users
  ADD COLUMN IF NOT EXISTS points_score integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN portal.users.points_score IS 'Cache do SUM(points) em operator_points. Mantido pelo trigger trg_award_points (FC).';

-- ============================================================================
-- 6) Drop portal.task_reviews (0 linhas, sem uso no código)
-- ----------------------------------------------------------------------------
-- Substituída pelo fluxo de ratings/operator_to_client_ratings com status.
-- ============================================================================

DROP TABLE IF EXISTS portal.task_reviews CASCADE;

-- ============================================================================
-- Fim 006_integration_ratings_model.sql
-- ============================================================================
