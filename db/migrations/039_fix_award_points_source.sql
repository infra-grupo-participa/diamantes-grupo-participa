-- ============================================================================
-- 039_fix_award_points_source.sql
-- ----------------------------------------------------------------------------
-- Corrige a FONTE de operadores na pontuação (gamificação).
--
-- Bug pré-existente: trg_award_points lia portal.demand_members WHERE
-- role='operator', mas desde a migration 016 os operadores vivem em
-- portal.demand_operators — demand_members só tem role='client'. Resultado:
-- NENHUM ponto era distribuído (operator_points sempre vazio).
--
-- Fix: ler demand_operators -> operators -> users (mapeando por e-mail; todos
-- os operadores têm user correspondente). Escala 5★ mantida (5=30, 4=15, 3=5).
--
-- Aplicado em produção quando operator_points=0 e demandas done=0 (sem risco de
-- duplicar histórico; afeta apenas avaliações futuras).
-- Aplicar DEPOIS da 038 (escala 5★).
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
  IF NEW.status <> 'submitted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' THEN RETURN NEW; END IF;
  IF NEW.demand_id IS NULL THEN RETURN NEW; END IF;

  v_points := CASE
    WHEN NEW.score >= 5 THEN 30
    WHEN NEW.score >= 4 THEN 15
    WHEN NEW.score >= 3 THEN 5
    ELSE 0
  END;
  v_reason := 'rating_' || NEW.score::text || 'star';
  IF v_points = 0 THEN RETURN NEW; END IF;

  FOR v_op_id IN
    SELECT DISTINCT u.id
    FROM portal.demand_operators dop
    JOIN portal.operators o ON o.id = dop.operator_id
    JOIN portal.users u ON lower(u.email) = lower(o.email) AND u.role IN ('operator','admin')
    WHERE dop.demand_id = NEW.demand_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM portal.operator_points WHERE rating_id = NEW.id AND user_id = v_op_id
    ) THEN
      INSERT INTO portal.operator_points (user_id, demand_id, rating_id, points, reason)
      VALUES (v_op_id, NEW.demand_id, NEW.id, v_points, v_reason);
      UPDATE portal.users SET points_score = points_score + v_points WHERE id = v_op_id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION portal._trg_award_points IS
  'Escala 5★ (5=30, 4=15, 3=5). Fonte demand_operators -> operators -> users (por email). Corrige bug da fonte demand_members vazia desde a 016.';

-- ============================================================================
-- Fim 039_fix_award_points_source.sql
-- ============================================================================
