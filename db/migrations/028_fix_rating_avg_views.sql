-- 028_fix_rating_avg_views.sql
-- v_operators e v_employees usavam r.user_id = o.id para calcular rating_avg,
-- mas portal.ratings.user_id é sempre NULL. Fix: unir via demand_operators.

CREATE OR REPLACE VIEW portal.v_operators
WITH (security_invoker = on)
AS
SELECT
  o.id,
  o.name,
  o.email,
  o.position_id,
  p.name                                                   AS position_name,
  p.color                                                  AS position_color,
  o.clickup_user_id,
  o.contract_active,
  o.status,
  o.points_score,
  o.metadata,
  o.created_at,
  o.updated_at,
  COUNT(DISTINCT ta.client_slug)::int                      AS students_count,
  COUNT(DISTINCT dop.demand_id)::int                       AS demands_count,
  COALESCE(ROUND(AVG(r.score)::numeric / 2.0, 2), 0.00)   AS rating_avg
FROM portal.operators o
LEFT JOIN portal.positions          p   ON p.id = o.position_id
LEFT JOIN portal.team_assignments   ta  ON ta.operator_id = o.id
LEFT JOIN portal.demand_operators   dop ON dop.operator_id = o.id
LEFT JOIN portal.ratings            r   ON r.demand_id = dop.demand_id
                                       AND r.status = 'submitted'
GROUP BY o.id, p.name, p.color;

GRANT SELECT ON portal.v_operators TO authenticated;

-- v_employees: mesma lógica via demand_operators
-- (a definição original não está nas migrations — recria preservando colunas)
CREATE OR REPLACE VIEW portal.v_employees
WITH (security_invoker = on)
AS
SELECT
  u.id,
  u.name,
  u.email,
  u.role,
  u.status,
  u.auth_user_id,
  u.position_id,
  u.created_at,
  u.updated_at,
  u.last_login_at,
  p.name                                                   AS position_name,
  p.color                                                  AS position_color,
  p.name                                                   AS position_slug,
  COUNT(DISTINCT ta.client_slug)::int                      AS students_count,
  COALESCE(ROUND(AVG(r.score)::numeric / 2.0, 2), 0.00)   AS rating_avg
FROM portal.users u
LEFT JOIN portal.positions        p   ON p.id = u.position_id
LEFT JOIN portal.operators        op  ON op.email = u.email
LEFT JOIN portal.team_assignments ta  ON ta.operator_id = op.id
LEFT JOIN portal.demand_operators dop ON dop.operator_id = op.id
LEFT JOIN portal.ratings          r   ON r.demand_id = dop.demand_id
                                     AND r.status = 'submitted'
WHERE u.role IN ('admin', 'operator')
GROUP BY u.id, p.name, p.color;

GRANT SELECT ON portal.v_employees TO authenticated;
