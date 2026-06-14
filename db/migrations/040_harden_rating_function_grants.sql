-- ============================================================================
-- 040_harden_rating_function_grants.sql
-- ----------------------------------------------------------------------------
-- Higiene de segurança (advisors): funções SECURITY DEFINER criadas nas 036-039
-- herdavam EXECUTE de PUBLIC (logo, chamáveis por anon via PostgREST RPC).
--   - Trigger functions não devem ter EXECUTE p/ ninguém (rodam via trigger).
--   - RPCs ficam só com authenticated (a autorização real é feita dentro da
--     função por is_admin()/auth.uid()/client_slug, mas remover anon é higiene).
-- ============================================================================

REVOKE EXECUTE ON FUNCTION portal._trg_award_points() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION portal._trg_project_completed_request_rating() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION portal.complete_project(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION portal.submit_project_rating(uuid, smallint, text, smallint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION portal.request_project_rating(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION portal.get_my_pending_project_ratings() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION portal.submit_client_rating(uuid, smallint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION portal.get_student_team(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION portal.expire_pending_ratings() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION portal.complete_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION portal.submit_project_rating(uuid, smallint, text, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION portal.request_project_rating(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION portal.get_my_pending_project_ratings() TO authenticated;
GRANT EXECUTE ON FUNCTION portal.submit_client_rating(uuid, smallint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION portal.get_student_team(text) TO authenticated;
GRANT EXECUTE ON FUNCTION portal.expire_pending_ratings() TO authenticated;

-- ============================================================================
-- Fim 040_harden_rating_function_grants.sql
-- ============================================================================
