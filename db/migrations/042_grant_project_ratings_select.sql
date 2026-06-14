-- ============================================================================
-- 042_grant_project_ratings_select.sql
-- ----------------------------------------------------------------------------
-- Achado no teste de RLS ao vivo: portal.project_ratings tinha a policy
-- project_ratings_select (FOR SELECT TO authenticated) porém SEM o GRANT
-- SELECT em nível de tabela — então a policy estava inerte e a view
-- portal.v_project_ratings (security_invoker = on) quebraria ("permission
-- denied") para um admin logado tentando ler as avaliações.
--
-- Concede SELECT a authenticated; a RLS continua restringindo as LINHAS
-- (cliente vê só as suas; admin vê todas via is_admin()). Escrita continua
-- só via RPC SECURITY DEFINER (submit_project_rating).
-- ============================================================================

GRANT SELECT ON portal.project_ratings TO authenticated;

-- ============================================================================
-- Fim 042_grant_project_ratings_select.sql
-- ============================================================================
