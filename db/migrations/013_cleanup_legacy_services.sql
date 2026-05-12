-- ============================================================================
-- 013_cleanup_legacy_services.sql
-- Remove serviços hardcoded (seeds manuais de 2026-05-09) que causavam
-- duplicatas na UI para clientes com serviços reais do Hotmart.
-- HOST sem offer_code é mantido (hospedagem gerenciada manualmente).
-- ============================================================================

DELETE FROM portal.services
WHERE offer_code IS NULL
  AND service_type != 'HOST'
  AND client_slug IN (
    SELECT DISTINCT client_slug
    FROM portal.services
    WHERE offer_code IS NOT NULL
  );

-- ============================================================================
-- Fim 013_cleanup_legacy_services.sql
-- ============================================================================
