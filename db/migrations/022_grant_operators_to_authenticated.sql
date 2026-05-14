-- ============================================================================
-- 022_grant_operators_to_authenticated.sql
-- Concede permissões em portal.operators e tabelas relacionadas para o role
-- 'authenticated'. A migration 016 esqueceu esses grants, causando
-- "permission denied for table operators" no admin (porque v_operators é
-- security_invoker=on e o admin lê a tabela base através da view).
--
-- Sintomas reportados antes do fix:
--   - Aba "Equipe Operacional" no admin/index.html: "Erro ao carregar:
--     permission denied for table operators".
--   - Tela admin/alunos-diamantes.html: lista não renderizava porque
--     getStudentTeam (RPC get_student_team) propagava a mesma exception.
--
-- A RLS de portal.operators continua ativa (policy operators_admin_all
-- usando portal.is_admin()), então o GRANT não abre dados pra non-admins.
-- É só corrigir o grant técnico esquecido.
--
-- Aplicado em prod via MCP em 2026-05-14 (apply_migration name=
-- "022_grant_operators_to_authenticated").
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON portal.operators           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON portal.demand_operators    TO authenticated;
GRANT SELECT                          ON portal.hotmart_offers     TO authenticated;
GRANT SELECT                          ON portal.hotmart_purchases  TO authenticated;

-- ============================================================================
-- Fim 022_grant_operators_to_authenticated.sql
-- ============================================================================
