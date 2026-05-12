-- ============================================================================
-- 004_operator_dashboard.sql
-- RPC `portal.get_operator_dashboard()` + view `v_my_students`
-- ----------------------------------------------------------------------------
-- Centraliza as métricas do dashboard do operador em uma única chamada RPC
-- (evita N+1 do front). View de alunos é separada porque o front precisa
-- listar com avatar/cargo, enquanto a RPC só conta.
-- ----------------------------------------------------------------------------
-- Aplicado também via MCP apply_migration.
-- ============================================================================

-- ============================================================================
-- 1) View v_my_students
-- ----------------------------------------------------------------------------
-- Alunos para os quais o operador autenticado está alocado via
-- portal.team_assignments. Inclui plano, mrr e avatar pra UI.
-- security_invoker = on respeita RLS de team_assignments (ta_operator_select)
-- e de clients (clients_select_own_slug não cobre operadores, então
-- precisamos adicionar política específica de clients pra operadores).
-- ============================================================================

CREATE OR REPLACE VIEW portal.v_my_students
WITH (security_invoker = on)
AS
SELECT DISTINCT
  c.slug                       AS client_slug,
  c.display_name,
  COALESCE(s.plan_name, 'Diamante') AS plan_name,
  s.monthly_value,
  s.status                     AS subscription_status,
  ta.assigned_at               AS my_assignment_at,
  p.name                       AS my_role_name,
  p.color                      AS my_role_color
FROM portal.team_assignments ta
JOIN portal.users     u ON u.id = ta.user_id
JOIN portal.clients   c ON c.slug = ta.client_slug
LEFT JOIN portal.subscriptions s ON s.client_slug = c.slug
LEFT JOIN portal.positions p ON p.id = ta.position_id
WHERE u.auth_user_id = auth.uid()
  AND u.role = 'operator'
ORDER BY c.display_name;

GRANT SELECT ON portal.v_my_students TO authenticated;

-- ============================================================================
-- 2) Política em portal.clients pra operadores enxergarem seus próprios alunos
-- ----------------------------------------------------------------------------
-- A view v_my_students JOIN com clients só funciona se RLS permitir SELECT.
-- Hoje só admin e cliente-próprio leem. Adicionar política específica para
-- operador via team_assignments.
-- ============================================================================

DROP POLICY IF EXISTS "clients_select_operator_assigned" ON portal.clients;
CREATE POLICY "clients_select_operator_assigned"
  ON portal.clients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM portal.team_assignments ta
      JOIN portal.users u ON u.id = ta.user_id
      WHERE ta.client_slug = clients.slug
        AND u.auth_user_id = auth.uid()
        AND u.role = 'operator'
        AND u.status = 'approved'
    )
  );

-- Idem para portal.subscriptions (operator precisa do plan_name/monthly_value)
DROP POLICY IF EXISTS "subs_operator_assigned_select" ON portal.subscriptions;
CREATE POLICY "subs_operator_assigned_select"
  ON portal.subscriptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM portal.team_assignments ta
      JOIN portal.users u ON u.id = ta.user_id
      WHERE ta.client_slug = subscriptions.client_slug
        AND u.auth_user_id = auth.uid()
        AND u.role = 'operator'
        AND u.status = 'approved'
    )
  );

-- ============================================================================
-- 3) RPC get_operator_dashboard()
-- ----------------------------------------------------------------------------
-- Retorna JSON com:
--   - kpi.open, kpi.in_progress, kpi.done_today, kpi.rating_avg
--   - workload[]: distribuição de status
--   - urgent[]: top 5 demandas com prazo apertado
--   - recent_activities[]: últimas 10 mensagens recebidas (não enviadas
--     pelo próprio operador) das demandas do operador
-- Tudo em uma roundtrip, security_invoker (RLS faz o filtro do user).
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.get_operator_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = portal, public
AS $$
DECLARE
  v_user_id uuid;
  v_today   date := CURRENT_DATE;
  v_result  jsonb;
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
           (
             SELECT MAX(m.created_at) FROM portal.demand_messages m WHERE m.demand_id = d.id
           ) AS last_message_at
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
      SELECT status, COUNT(*)::int AS cnt
      FROM my_demands
      GROUP BY status
      ORDER BY status
    ) t
  ),
  urgent AS (
    SELECT jsonb_agg(row_to_json(u)) AS items
    FROM (
      SELECT id, title, client_display_name, status, ends_at,
             (ends_at - v_today) AS days_left
      FROM my_demands
      WHERE status IN ('open','in_progress','review')
        AND ends_at IS NOT NULL
        AND (ends_at - v_today) <= 3
      ORDER BY ends_at ASC NULLS LAST
      LIMIT 5
    ) u
  ),
  recent AS (
    SELECT jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC) AS items
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
      ORDER BY m.created_at DESC
      LIMIT 10
    ) r
  ),
  rating AS (
    SELECT ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS total
    FROM portal.ratings
    WHERE user_id = v_user_id
  )
  SELECT jsonb_build_object(
    'kpi', jsonb_build_object(
      'open_count',         (SELECT open_count FROM kpi),
      'in_progress_count',  (SELECT in_progress_count FROM kpi),
      'done_today_count',   (SELECT done_today_count FROM kpi),
      'active_total',       (SELECT active_total FROM kpi),
      'rating_avg',         (SELECT avg_score FROM rating),
      'rating_count',       (SELECT total FROM rating)
    ),
    'workload', COALESCE((SELECT items FROM workload), '[]'::jsonb),
    'urgent',   COALESCE((SELECT items FROM urgent),   '[]'::jsonb),
    'recent',   COALESCE((SELECT items FROM recent),   '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.get_operator_dashboard() TO authenticated;
REVOKE EXECUTE ON FUNCTION portal.get_operator_dashboard() FROM anon;

-- ============================================================================
-- Fim 004_operator_dashboard.sql
-- ============================================================================
