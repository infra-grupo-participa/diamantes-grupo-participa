-- ============================================================================
-- 038_unify_rating_scale_5stars.sql
-- ----------------------------------------------------------------------------
-- Unifica a escala da avaliação por DEMANDA (cliente→operador) de 1-10 para
-- 1-5 estrelas, alinhando com a avaliação de PROJETO (036) e com o mercado.
--
-- ⚠️ ORDEM DE DEPLOY: aplique ESTA migration ANTES de subir a versão do app
--    que usa 5 estrelas na avaliação de demanda. Se a UI 5★ subir antes, o
--    CHECK 1-5 ainda não existe e a nota cai na escala errada.
--
-- O QUE FAZ:
--   1. Converte ratings.score 1-10 → 1-5 (CEIL(score/2), piso 1). Guard por
--      MAX(score) para ser idempotente.
--   2. Troca o CHECK de score para 1..5.
--   3. submit_client_rating passa a validar 1..5.
--   4. trg_award_points re-mapeado para 5★ (5=30, 4=15, 3=5, ≤2=0).
--   5. Views v_operators / v_employees / get_student_team deixam de dividir por
--      2 (a média já fica em 0..5).
--
-- NÃO MEXE na gamificação de fonte: o trigger continua lendo demand_members
-- role='operator'. ⚠️ ATENÇÃO: desde a 016 os operadores vivem em
-- demand_operators, então é provável que esse trigger não esteja pontuando
-- ninguém. Isso é um bug PRÉ-EXISTENTE e SEPARADO — corrigir noutra migration
-- após validação, para não introduzir efeito colateral na pontuação aqui.
--
-- Pontos históricos NÃO são recalculados (referem-se a notas na escala antiga).
-- TRANSACIONAL: confira os SELECTs e então COMMIT.
-- ============================================================================

BEGIN;

-- 1) Conversão de dados (idempotente: só roda se ainda houver score > 5)
DO $$
BEGIN
  IF (SELECT COALESCE(MAX(score), 0) FROM portal.ratings) > 5 THEN
    UPDATE portal.ratings
       SET score = GREATEST(1, CEIL(score / 2.0))::smallint;
  END IF;
END $$;

-- 2) Troca o CHECK de score (1..10 → 1..5). Remove qualquer CHECK que cite score.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'portal.ratings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%score%'
  LOOP
    EXECUTE 'ALTER TABLE portal.ratings DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END $$;

ALTER TABLE portal.ratings
  ADD CONSTRAINT ratings_score_1_5 CHECK (score BETWEEN 1 AND 5);

-- 3) submit_client_rating — valida 1..5
CREATE OR REPLACE FUNCTION portal.submit_client_rating(
  p_demand_id uuid,
  p_score     smallint,
  p_comment   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
  v_caller    portal.users%ROWTYPE;
  v_demand    portal.demands%ROWTYPE;
  v_rating_id uuid;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid();
  IF v_caller.id IS NULL OR v_caller.status <> 'approved' THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_demand FROM portal.demands WHERE id = p_demand_id;
  IF v_demand.id IS NULL THEN
    RAISE EXCEPTION 'Demanda não encontrada.' USING ERRCODE = '22023';
  END IF;

  IF NOT portal.is_admin() AND v_caller.client_slug IS DISTINCT FROM v_demand.client_slug THEN
    RAISE EXCEPTION 'Você não pode avaliar essa demanda.' USING ERRCODE = '42501';
  END IF;

  IF p_score IS NULL OR p_score < 1 OR p_score > 5 THEN
    RAISE EXCEPTION 'A nota precisa estar entre 1 e 5 estrelas.' USING ERRCODE = '22023';
  END IF;

  PERFORM portal.request_client_rating(p_demand_id);

  UPDATE portal.ratings
     SET score        = p_score,
         comment      = COALESCE(p_comment, comment),
         user_id      = v_caller.id,
         status       = 'submitted',
         submitted_at = now()
   WHERE demand_id = p_demand_id
     AND client_slug = v_demand.client_slug
     AND status IN ('pending', 'submitted')
   RETURNING id INTO v_rating_id;

  RETURN jsonb_build_object('ok', true, 'rating_id', v_rating_id, 'score', p_score);
END;
$$;

REVOKE EXECUTE ON FUNCTION portal.submit_client_rating(uuid, smallint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION portal.submit_client_rating(uuid, smallint, text) TO authenticated;

COMMENT ON FUNCTION portal.submit_client_rating IS 'Cliente envia avaliação 1..5 estrelas + comentário. Atualiza placeholder pending → submitted.';

-- 4) trg_award_points — escala 5★ (mantém a fonte demand_members; ver aviso no topo)
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
  IF NEW.status <> 'submitted' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' THEN
    RETURN NEW;
  END IF;
  IF NEW.demand_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Escala 5★: 5=30, 4=15, 3=5, ≤2=0
  v_points := CASE
    WHEN NEW.score >= 5 THEN 30
    WHEN NEW.score >= 4 THEN 15
    WHEN NEW.score >= 3 THEN 5
    ELSE 0
  END;
  v_reason := 'rating_' || NEW.score::text || 'star';

  IF v_points = 0 THEN
    RETURN NEW;
  END IF;

  FOR v_op_id IN
    SELECT dm.user_id
    FROM portal.demand_members dm
    WHERE dm.demand_id = NEW.demand_id AND dm.role = 'operator'
  LOOP
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

COMMENT ON FUNCTION portal._trg_award_points IS 'Escala 5★: 5=+30, 4=+15, 3=+5. Fonte demand_members role=operator (ver aviso: possivelmente vazio desde a 016/demand_operators).';

-- 5) Views: rating_avg deixa de dividir por 2 (escala já é 0..5)
CREATE OR REPLACE VIEW portal.v_operators
WITH (security_invoker = on)
AS
SELECT
  o.id, o.name, o.email, o.position_id,
  p.name AS position_name, p.color AS position_color,
  o.clickup_user_id, o.contract_active, o.status, o.points_score,
  o.metadata, o.created_at, o.updated_at,
  COUNT(DISTINCT ta.client_slug)::int AS students_count,
  COUNT(DISTINCT dop.demand_id)::int  AS demands_count,
  COALESCE(ROUND(AVG(r.score)::numeric, 2), 0.00) AS rating_avg
FROM portal.operators o
LEFT JOIN portal.positions        p   ON p.id = o.position_id
LEFT JOIN portal.team_assignments ta  ON ta.operator_id = o.id
LEFT JOIN portal.demand_operators dop ON dop.operator_id = o.id
LEFT JOIN portal.ratings          r   ON r.demand_id = dop.demand_id AND r.status = 'submitted'
GROUP BY o.id, p.name, p.color;

GRANT SELECT ON portal.v_operators TO authenticated;

CREATE OR REPLACE VIEW portal.v_employees
WITH (security_invoker = on)
AS
SELECT
  u.id, u.name, u.email, u.role, u.status, u.auth_user_id, u.position_id,
  u.created_at, u.updated_at, u.last_login_at,
  p.name AS position_name, p.color AS position_color, p.name AS position_slug,
  COUNT(DISTINCT ta.client_slug)::int AS students_count,
  COALESCE(ROUND(AVG(r.score)::numeric, 2), 0.00) AS rating_avg
FROM portal.users u
LEFT JOIN portal.positions        p   ON p.id = u.position_id
LEFT JOIN portal.operators        op  ON op.email = u.email
LEFT JOIN portal.team_assignments ta  ON ta.operator_id = op.id
LEFT JOIN portal.demand_operators dop ON dop.operator_id = op.id
LEFT JOIN portal.ratings          r   ON r.demand_id = dop.demand_id AND r.status = 'submitted'
WHERE u.role IN ('admin', 'operator')
GROUP BY u.id, p.name, p.color;

GRANT SELECT ON portal.v_employees TO authenticated;

-- get_student_team: média por operador, sem dividir por 2
CREATE OR REPLACE FUNCTION portal.get_student_team(p_slug text)
RETURNS TABLE (
  assignment_id uuid, operator_id uuid, user_id uuid,
  user_name text, user_email text, user_status text,
  position_id uuid, position_name text, position_color text,
  rating_avg numeric, rating_count int,
  assigned_at timestamptz, notes text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'portal','public'
AS $$
  SELECT
    ta.id, o.id, o.id, o.name, o.email, o.status,
    p.id, p.name, p.color,
    COALESCE((
      SELECT ROUND(AVG(r.score)::numeric, 2)
      FROM portal.ratings r
      JOIN portal.demand_operators dop ON dop.demand_id = r.demand_id
      WHERE r.client_slug = p_slug AND dop.operator_id = o.id AND r.status = 'submitted'
    ), 0.00),
    COALESCE((
      SELECT count(*)::int
      FROM portal.ratings r
      JOIN portal.demand_operators dop ON dop.demand_id = r.demand_id
      WHERE r.client_slug = p_slug AND dop.operator_id = o.id AND r.status = 'submitted'
    ), 0),
    ta.assigned_at, ta.notes
  FROM portal.team_assignments ta
  JOIN portal.operators o ON o.id = ta.operator_id
  JOIN portal.positions p ON p.id = ta.position_id
  WHERE ta.client_slug = p_slug
  ORDER BY p.sort_order, o.name;
$$;

GRANT EXECUTE ON FUNCTION portal.get_student_team(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal.get_student_team(text) FROM anon;

-- 6) VERIFICAÇÃO
SELECT 'ratings' AS tabela, MIN(score) AS min, MAX(score) AS max,
       COUNT(*) FILTER (WHERE status='submitted') AS submitted
FROM portal.ratings;

-- Se ok: COMMIT;  /  Se algo estranho: ROLLBACK;
-- COMMIT;
-- ROLLBACK;

-- ============================================================================
-- Fim 038_unify_rating_scale_5stars.sql
-- ============================================================================
