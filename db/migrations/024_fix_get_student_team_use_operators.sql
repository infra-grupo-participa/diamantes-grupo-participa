-- ============================================================================
-- 024_fix_get_student_team_use_operators.sql
-- Corrige portal.get_student_team para usar portal.operators (não portal.users).
--
-- A migration 016 aboliu o role 'operator' em portal.users e moveu o cadastro
-- operacional para portal.operators (sem auth_user_id). A RPC original ficou
-- com JOIN portal.users desatualizado, retornando equipe VAZIA para todos os
-- alunos (porque depois da 016, ta.user_id passou a apontar pra users
-- desabilitados / inexistentes e a 019 limpou parte deles).
--
-- Mantém o mesmo formato de retorno (user_id/user_name/etc.) para
-- compatibilidade com a UI atual; user_id agora é o operator_id (espelho)
-- para não quebrar chamadas existentes que ainda usam o nome antigo.
--
-- Aplicado em prod via MCP em 2026-05-14 antes deste commit.
-- ============================================================================

DROP FUNCTION IF EXISTS portal.get_student_team(text);

CREATE FUNCTION portal.get_student_team(p_slug text)
RETURNS TABLE (
  assignment_id  uuid,
  operator_id    uuid,
  user_id        uuid,           -- alias de operator_id (compat com UI)
  user_name      text,           -- nome do operador (compat)
  user_email     text,
  user_status    text,
  position_id    uuid,
  position_name  text,
  position_color text,
  rating_avg     numeric,
  assigned_at    timestamptz,
  notes          text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'portal','public'
AS $$
  SELECT
    ta.id                                                         AS assignment_id,
    o.id                                                          AS operator_id,
    o.id                                                          AS user_id,
    o.name                                                        AS user_name,
    o.email                                                       AS user_email,
    o.status                                                      AS user_status,
    p.id                                                          AS position_id,
    p.name                                                        AS position_name,
    p.color                                                       AS position_color,
    COALESCE(
      (SELECT ROUND(AVG(score)::numeric / 2.0, 2)
         FROM portal.ratings r WHERE r.client_slug = p_slug),
      0.00
    )                                                             AS rating_avg,
    ta.assigned_at,
    ta.notes
  FROM portal.team_assignments ta
  JOIN portal.operators o   ON o.id = ta.operator_id
  JOIN portal.positions p   ON p.id = ta.position_id
  WHERE ta.client_slug = p_slug
  ORDER BY p.sort_order, o.name;
$$;

GRANT EXECUTE ON FUNCTION portal.get_student_team(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal.get_student_team(text) FROM anon;

COMMENT ON FUNCTION portal.get_student_team IS
  'Equipe atribuída ao aluno. Lê de portal.operators (modelo novo pós-016). user_id é mantido como alias de operator_id por compat com chamadas antigas.';

-- ============================================================================
-- Fim 024_fix_get_student_team_use_operators.sql
-- ============================================================================
