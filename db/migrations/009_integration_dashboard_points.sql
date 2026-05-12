-- ============================================================================
-- 009_integration_dashboard_points.sql
-- Estende get_operator_dashboard com pontos, ranking e ratings recebidas.
-- ----------------------------------------------------------------------------
-- Dependências:
--   - 006 (operator_points, users.points_score, ratings.demand_id)
--   - 008 (trg_award_points populando os pontos)
--
-- Output novo no jsonb:
--   - kpi.points_this_month  (SUM operator_points do mês corrente)
--   - kpi.points_total       (users.points_score acumulado)
--   - kpi.ranking_position   (RANK() entre operadores aprovados; 1 = topo)
--   - kpi.ranking_total      (qtd total de operadores aprovados)
--   - kpi.rating_avg / kpi.rating_count: agora cruzam por ratings recebidas
--     em demandas onde o operador era membro (mais preciso que user_id direto)
--   - recent_ratings_received[]: últimas 5 ratings que pontuaram este operador
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.get_operator_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'portal', 'public'
AS $$
DECLARE
  v_user_id    uuid;
  v_today      date := CURRENT_DATE;
  v_result     jsonb;
BEGIN
  SELECT id INTO v_user_id
  FROM portal.users
  WHERE auth_user_id = auth.uid()
    AND role = 'operator'
    AND status = 'approved'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_an_operator');
  END IF;

  WITH my_demands AS (
    SELECT d.id, d.title, d.status, d.client_slug, d.created_at,
           d.updated_at, d.ends_at, d.finalized_at,
           c.display_name AS client_display_name,
           (SELECT MAX(m.created_at) FROM portal.demand_messages m WHERE m.demand_id = d.id) AS last_message_at
    FROM portal.demand_members dm
    JOIN portal.demands  d ON d.id = dm.demand_id
    JOIN portal.clients  c ON c.slug = d.client_slug
    WHERE dm.user_id = v_user_id
      AND dm.role = 'operator'
  ),
  kpi AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'open')                                      AS open_count,
      COUNT(*) FILTER (WHERE status = 'in_progress')                               AS in_progress_count,
      COUNT(*) FILTER (WHERE status = 'done' AND finalized_at::date = v_today)     AS done_today_count,
      COUNT(*) FILTER (WHERE status IN ('open','in_progress','review'))            AS active_total
    FROM my_demands
  ),
  workload AS (
    SELECT jsonb_agg(jsonb_build_object('status', status, 'count', cnt)) AS items
    FROM (
      SELECT status, COUNT(*)::int AS cnt FROM my_demands GROUP BY status ORDER BY status
    ) t
  ),
  urgent AS (
    SELECT jsonb_agg(row_to_json(u)) AS items
    FROM (
      SELECT id, title, client_display_name, status, ends_at,
             (ends_at - v_today) AS days_left
      FROM my_demands
      WHERE status IN ('open','in_progress','review')
        AND ends_at IS NOT NULL AND (ends_at - v_today) <= 3
      ORDER BY ends_at ASC NULLS LAST LIMIT 5
    ) u
  ),
  recent AS (
    SELECT jsonb_agg(row_to_json(r)) AS items
    FROM (
      SELECT m.id, m.demand_id, m.created_at,
             LEFT(m.content, 120) AS preview,
             COALESCE(au.name, 'Aluno') AS author_name,
             md.title AS demand_title
      FROM portal.demand_messages m
      JOIN my_demands md ON md.id = m.demand_id
      LEFT JOIN portal.users au ON au.id = m.user_id
      WHERE m.user_id IS DISTINCT FROM v_user_id
        AND m.created_at >= now() - interval '7 days'
      ORDER BY m.created_at DESC LIMIT 10
    ) r
  ),
  -- Rating médio: pelas ratings que pontuaram este operador (operator_points
  -- contém rating_id; cruzando, pegamos só ratings que realmente referem-se a
  -- este operador via demand_members)
  my_ratings AS (
    SELECT DISTINCT r.id, r.score, r.comment, r.submitted_at, r.demand_id
    FROM portal.operator_points op
    JOIN portal.ratings r ON r.id = op.rating_id
    WHERE op.user_id = v_user_id
      AND r.status = 'submitted'
  ),
  rating AS (
    SELECT ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS total
    FROM my_ratings
  ),
  recent_received AS (
    SELECT jsonb_agg(row_to_json(rr) ORDER BY rr.submitted_at DESC) AS items
    FROM (
      SELECT mr.id, mr.score, mr.comment, mr.submitted_at,
             d.title AS demand_title, c.display_name AS client_display_name
      FROM my_ratings mr
      JOIN portal.demands d ON d.id = mr.demand_id
      JOIN portal.clients c ON c.slug = d.client_slug
      ORDER BY mr.submitted_at DESC NULLS LAST
      LIMIT 5
    ) rr
  ),
  points AS (
    SELECT
      COALESCE(SUM(points), 0) FILTER (WHERE created_at >= date_trunc('month', now())) AS this_month,
      COALESCE(SUM(points), 0)                                                          AS total_log
    FROM portal.operator_points
    WHERE user_id = v_user_id
  ),
  ranking AS (
    SELECT pos AS my_pos, total
    FROM (
      SELECT u.id,
             RANK() OVER (ORDER BY u.points_score DESC, u.id) AS pos,
             COUNT(*) OVER () AS total
      FROM portal.users u
      WHERE u.role = 'operator' AND u.status = 'approved'
    ) ranked
    WHERE ranked.id = v_user_id
  )
  SELECT jsonb_build_object(
    'kpi', jsonb_build_object(
      'open_count',         (SELECT open_count        FROM kpi),
      'in_progress_count',  (SELECT in_progress_count FROM kpi),
      'done_today_count',   (SELECT done_today_count  FROM kpi),
      'active_total',       (SELECT active_total      FROM kpi),
      'rating_avg',         (SELECT avg_score         FROM rating),
      'rating_count',       (SELECT total             FROM rating),
      'points_this_month',  (SELECT this_month        FROM points),
      'points_total',       (SELECT COALESCE(u.points_score, 0) FROM portal.users u WHERE u.id = v_user_id),
      'ranking_position',   (SELECT my_pos            FROM ranking),
      'ranking_total',      (SELECT total             FROM ranking)
    ),
    'workload',                COALESCE((SELECT items FROM workload),        '[]'::jsonb),
    'urgent',                  COALESCE((SELECT items FROM urgent),          '[]'::jsonb),
    'recent',                  COALESCE((SELECT items FROM recent),          '[]'::jsonb),
    'recent_ratings_received', COALESCE((SELECT items FROM recent_received), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.get_operator_dashboard() TO authenticated;
REVOKE EXECUTE ON FUNCTION portal.get_operator_dashboard() FROM anon;

COMMENT ON FUNCTION portal.get_operator_dashboard IS 'Dashboard agregado do operador. Inclui KPIs, workload, urgent, recent (mensagens), recent_ratings_received e métricas de pontuação + ranking.';

-- ============================================================================
-- Fim 009_integration_dashboard_points.sql
-- ============================================================================
