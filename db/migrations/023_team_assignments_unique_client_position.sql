-- ============================================================================
-- 023_team_assignments_unique_client_position.sql
-- Garante que cada (cliente × setor) tem no máximo 1 atribuição em
-- portal.team_assignments. Reflete a regra de negócio: cada cliente tem
-- um único operador por setor (Tráfego, Web Design, Edição, etc).
--
-- O constraint anterior (client_slug, user_id, position_id) só bloqueava
-- o MESMO operador duplicado no mesmo cargo — não impedia dois operadores
-- diferentes no mesmo setor.
--
-- Aplicado em prod via MCP em 2026-05-14 antes deste commit.
-- ============================================================================

ALTER TABLE portal.team_assignments
  ADD CONSTRAINT team_assignments_unique_client_position
  UNIQUE (client_slug, position_id);

-- ============================================================================
-- Fim 023_team_assignments_unique_client_position.sql
-- ============================================================================
