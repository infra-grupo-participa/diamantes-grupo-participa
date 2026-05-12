-- ============================================================================
-- 008_integration_triggers.sql
-- Triggers de automação que fecham o ciclo da demanda.
-- ----------------------------------------------------------------------------
-- Dependências:
--   - 006 (tabelas: demand_status_log, operator_points, ratings.status,
--     operator_to_client_ratings, users.points_score)
--   - 007 (RPCs: request_client_rating, request_operator_ratings)
--
-- Triggers e função criados:
--   1) trg_demand_status_log: grava transições em demand_status_log
--   2) trg_demand_done_request_ratings: ao virar done dispara
--      request_client_rating + request_operator_ratings
--   3) trg_award_points: pending→submitted em ratings calcula pontos
--      (escala A) por operador da demanda e atualiza users.points_score
--   4) expire_pending_ratings(): RPC pra cron diário marcar pendentes >7d
-- ============================================================================

-- ============================================================================
-- 1) trg_demand_status_log — registra transições de status
-- ----------------------------------------------------------------------------
-- AFTER UPDATE em demands WHEN (OLD.status IS DISTINCT FROM NEW.status).
-- by_user_id resolvido via auth.uid() → portal.users.
-- SECURITY DEFINER necessário porque o operador que está mudando o status
-- pode não ter INSERT direto em demand_status_log (RLS bloqueia).
-- ============================================================================

CREATE OR REPLACE FUNCTION portal._trg_demand_status_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM portal.users WHERE auth_user_id = auth.uid();
  INSERT INTO portal.demand_status_log (demand_id, from_status, to_status, by_user_id)
  VALUES (NEW.id, OLD.status, NEW.status, v_user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demand_status_log ON portal.demands;
CREATE TRIGGER trg_demand_status_log
  AFTER UPDATE OF status ON portal.demands
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION portal._trg_demand_status_log();

COMMENT ON FUNCTION portal._trg_demand_status_log IS 'Append-only: cada transição de demands.status vira linha em demand_status_log.';

-- ============================================================================
-- 2) trg_demand_done_request_ratings — auto-request ao fechar
-- ----------------------------------------------------------------------------
-- AFTER UPDATE em demands WHEN (NEW.status='done' AND OLD.status<>'done').
-- Dispara as duas RPCs de placeholder. Como elas são idempotentes, rodar
-- duas vezes não causa duplicação.
-- ============================================================================

CREATE OR REPLACE FUNCTION portal._trg_demand_done_request_ratings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
BEGIN
  PERFORM portal.request_client_rating(NEW.id);
  PERFORM portal.request_operator_ratings(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demand_done_request_ratings ON portal.demands;
CREATE TRIGGER trg_demand_done_request_ratings
  AFTER UPDATE OF status ON portal.demands
  FOR EACH ROW
  WHEN (NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done')
  EXECUTE FUNCTION portal._trg_demand_done_request_ratings();

COMMENT ON FUNCTION portal._trg_demand_done_request_ratings IS 'Ao virar done, dispara placeholders de avaliação cliente→operador e operador→cliente.';

-- ============================================================================
-- 3) trg_award_points — pontuação por operador
-- ----------------------------------------------------------------------------
-- AFTER UPDATE em ratings WHEN OLD.status='pending' AND NEW.status='submitted'.
-- Também roda em INSERT direto com status='submitted' (compat futuro).
-- Escala A:
--   score 9-10 → 30 pontos
--   score 7-8  → 15 pontos
--   score 5-6  → 5 pontos
--   score <5   → 0 pontos
-- Cada operador da demanda recebe esses pontos. INSERT em operator_points
-- + UPDATE em users.points_score (cache).
-- Idempotência: se já existir operator_points com (rating_id, user_id), pula.
-- ============================================================================

CREATE OR REPLACE FUNCTION portal._trg_award_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
  v_points int;
  v_reason text;
  v_op_id  uuid;
BEGIN
  -- Só roda quando vira submitted (vindo de pending ou diretamente)
  IF NEW.status <> 'submitted' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' THEN
    -- Já era submitted antes; não pontuar de novo
    RETURN NEW;
  END IF;
  IF NEW.demand_id IS NULL THEN
    -- Rating legacy sem demand_id (ratings histórias do ClickUp): não pontuar
    RETURN NEW;
  END IF;

  -- Escala A
  v_points := CASE
    WHEN NEW.score >= 9 THEN 30
    WHEN NEW.score >= 7 THEN 15
    WHEN NEW.score >= 5 THEN 5
    ELSE 0
  END;
  v_reason := 'rating_' || NEW.score::text;

  IF v_points = 0 THEN
    RETURN NEW; -- não cria linha de log com 0 pontos
  END IF;

  -- Para cada operador da demanda, lança pontos
  FOR v_op_id IN
    SELECT dm.user_id
    FROM portal.demand_members dm
    WHERE dm.demand_id = NEW.demand_id AND dm.role = 'operator'
  LOOP
    -- Idempotência leve: não duplicar para o mesmo (rating, user)
    IF NOT EXISTS (
      SELECT 1 FROM portal.operator_points
      WHERE rating_id = NEW.id AND user_id = v_op_id
    ) THEN
      INSERT INTO portal.operator_points (user_id, demand_id, rating_id, points, reason)
      VALUES (v_op_id, NEW.demand_id, NEW.id, v_points, v_reason);

      UPDATE portal.users SET points_score = points_score + v_points WHERE id = v_op_id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_points ON portal.ratings;
CREATE TRIGGER trg_award_points
  AFTER INSERT OR UPDATE OF status ON portal.ratings
  FOR EACH ROW
  EXECUTE FUNCTION portal._trg_award_points();

COMMENT ON FUNCTION portal._trg_award_points IS 'Escala A: 9-10=+30, 7-8=+15, 5-6=+5. Distribui para todos operadores da demanda. Atualiza cache users.points_score.';

-- ============================================================================
-- 4) expire_pending_ratings() — RPC pra cron 7d
-- ----------------------------------------------------------------------------
-- Marca como 'expired' todos os placeholders (cliente E operador) com
-- created_at > 7 dias. NÃO pontua (escala A já não pontua score<5).
-- Pode ser chamada manualmente ou agendada via pg_cron / cron-job.org.
-- Retorna contagem por tipo.
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.expire_pending_ratings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
  v_client_expired  int;
  v_oper_expired    int;
BEGIN
  WITH upd AS (
    UPDATE portal.ratings
       SET status = 'expired'
     WHERE status = 'pending'
       AND created_at < now() - interval '7 days'
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_client_expired FROM upd;

  WITH upd AS (
    UPDATE portal.operator_to_client_ratings
       SET status = 'expired'
     WHERE status = 'pending'
       AND created_at < now() - interval '7 days'
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_oper_expired FROM upd;

  RETURN jsonb_build_object(
    'ok', true,
    'client_ratings_expired', v_client_expired,
    'operator_ratings_expired', v_oper_expired,
    'ran_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION portal.expire_pending_ratings() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION portal.expire_pending_ratings() TO authenticated;

COMMENT ON FUNCTION portal.expire_pending_ratings IS 'Marca placeholders pending > 7 dias como expired. Chamar via cron diário.';

-- ============================================================================
-- 5) Backfill: gera demand_status_log retroativo para demandas já fechadas
-- ----------------------------------------------------------------------------
-- Para as poucas demandas já existentes em done, cria uma entrada sintética
-- "→done" usando finalized_at (ou updated_at) e created_by. Útil pra que a
-- view de lifecycle (FF) não tenha gaps.
-- ============================================================================

INSERT INTO portal.demand_status_log (demand_id, from_status, to_status, by_user_id, changed_at)
SELECT d.id, NULL, d.status, d.created_by, COALESCE(d.finalized_at, d.updated_at, d.created_at)
FROM portal.demands d
WHERE d.status IN ('done','review','in_progress')
  AND NOT EXISTS (
    SELECT 1 FROM portal.demand_status_log l
    WHERE l.demand_id = d.id
  );

-- ============================================================================
-- Fim 008_integration_triggers.sql
-- ============================================================================
