-- ============================================================================
-- 041_perf_rls_initplan_project_ratings.sql
-- ----------------------------------------------------------------------------
-- Performance (advisor auth_rls_initplan): a policy project_ratings_select
-- chamava auth.uid()/is_admin() por linha. Envolver em (select ...) faz o
-- Postgres avaliar uma única vez por query.
-- Também revoga authenticated de expire_pending_ratings (rotina de cron).
-- ============================================================================

DROP POLICY IF EXISTS project_ratings_select ON portal.project_ratings;
CREATE POLICY project_ratings_select ON portal.project_ratings
  FOR SELECT TO authenticated
  USING (
    client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = (select auth.uid()) LIMIT 1)
    OR (select portal.is_admin())
  );

REVOKE EXECUTE ON FUNCTION portal.expire_pending_ratings() FROM authenticated;

-- ============================================================================
-- Fim 041_perf_rls_initplan_project_ratings.sql
-- ============================================================================
