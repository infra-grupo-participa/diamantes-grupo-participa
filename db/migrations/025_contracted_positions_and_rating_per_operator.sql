-- ============================================================================
-- 025_contracted_positions_and_rating_per_operator.sql
--
-- 4 mudanças relacionadas a equipe/avaliações:
--   1. Adiciona portal.positions slug='copywriter' (faltava — 4 services com
--      Copywriter ativos sem mapping).
--   2. Cria portal.fn_service_type_to_position_slug(text) — normaliza
--      service_type em position_slug, mesma lógica usada nas migrations
--      015/020/021.
--   3. Cria portal.get_student_contracted_positions(text) — retorna lista de
--      position_id's que o aluno realmente contratou (services active ou
--      delinquent). Usada pelo modal "Adicionar integrante" para ocultar
--      operadores de setores que o aluno NÃO contratou.
--   4. Recria portal.get_student_team(text) com rating_avg correto: média
--      por OPERADOR (via demands → demand_operators → ratings deste cliente),
--      não a média do cliente repetida em cada linha como estava antes.
--      Retorna também rating_count.
--
-- Aplicado em prod via MCP em 2026-05-14 antes deste commit.
-- ============================================================================

-- 1) Position faltante
INSERT INTO portal.positions (slug, name, color, active, sort_order)
VALUES ('copywriter', 'Copywriter', '#9b59b6', true, 25)
ON CONFLICT (slug) DO UPDATE SET active = true;

-- 2) Função utilitária service_type → position_slug
CREATE OR REPLACE FUNCTION portal.fn_service_type_to_position_slug(p_service_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(p_service_type) LIKE '%TRÁFEGO%' OR upper(p_service_type) LIKE '%TRAFEGO%'
         OR upper(p_service_type) IN ('ANÚNCIOS PAGOS','ANUNCIOS PAGOS')                  THEN 'gestor-trafego'
    WHEN upper(p_service_type) LIKE '%WEB DESIGN%'
         OR upper(p_service_type) IN ('WEBDESIGNER','WEB DESIGNER','WEB_DESIGNER')        THEN 'web-designer'
    WHEN upper(p_service_type) LIKE '%EDIÇÃO DE VÍDEO%'
         OR upper(p_service_type) LIKE '%EDICAO DE VIDEO%'
         OR upper(p_service_type) LIKE '%EDIÇÃO DE VIDEO%'
         OR upper(p_service_type) = 'EDICAO_VIDEO'                                        THEN 'editor-video'
    WHEN upper(p_service_type) LIKE '%REDES SOCIAIS%'
         OR upper(p_service_type) IN ('SOCIAL MEDIA','SOCIAL_MEDIA')                      THEN 'social-media'
    WHEN upper(p_service_type) LIKE '%DISPAROS%'
         OR upper(p_service_type) IN ('AUTOMAÇÃO','AUTOMACAO')                            THEN 'automacao'
    WHEN upper(p_service_type) LIKE '%DESIGN GRÁFICO%'
         OR upper(p_service_type) LIKE '%DESIGN GRAFICO%'
         OR upper(p_service_type) = 'DESIGNER'                                            THEN 'designer'
    WHEN upper(p_service_type) LIKE '%COPYWRITER%' OR upper(p_service_type) = 'COPY'      THEN 'copywriter'
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION portal.fn_service_type_to_position_slug(text) TO authenticated;

COMMENT ON FUNCTION portal.fn_service_type_to_position_slug IS
  'Normaliza service_type (string livre vinda do Hotmart) em portal.positions.slug. NULL se não mapear.';

-- 3) Setores efetivamente contratados pelo aluno
CREATE OR REPLACE FUNCTION portal.get_student_contracted_positions(p_slug text)
RETURNS TABLE (
  position_id   uuid,
  position_slug text,
  position_name text,
  service_count int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'portal','public'
AS $$
  SELECT
    p.id,
    p.slug,
    p.name,
    count(*)::int AS service_count
  FROM portal.services s
  JOIN portal.positions p
    ON p.slug = portal.fn_service_type_to_position_slug(s.service_type)
  WHERE s.client_slug = p_slug
    AND s.status IN ('active','delinquent')
  GROUP BY p.id, p.slug, p.name, p.sort_order
  ORDER BY p.sort_order;
$$;

GRANT EXECUTE ON FUNCTION portal.get_student_contracted_positions(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal.get_student_contracted_positions(text) FROM anon;

COMMENT ON FUNCTION portal.get_student_contracted_positions IS
  'Setores que o aluno realmente contratou (services active ou delinquent). Base para filtrar operadores no modal de equipe.';

-- 4) get_student_team com rating_avg por OPERADOR (não do cliente)
DROP FUNCTION IF EXISTS portal.get_student_team(text);

CREATE FUNCTION portal.get_student_team(p_slug text)
RETURNS TABLE (
  assignment_id  uuid,
  operator_id    uuid,
  user_id        uuid,           -- alias de operator_id (compat com UI)
  user_name      text,
  user_email     text,
  user_status    text,
  position_id    uuid,
  position_name  text,
  position_color text,
  rating_avg     numeric,        -- média escala 0..5 do cliente p/ este operador
  rating_count   int,
  assigned_at    timestamptz,
  notes          text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'portal','public'
AS $$
  SELECT
    ta.id                AS assignment_id,
    o.id                 AS operator_id,
    o.id                 AS user_id,
    o.name               AS user_name,
    o.email              AS user_email,
    o.status             AS user_status,
    p.id                 AS position_id,
    p.name               AS position_name,
    p.color              AS position_color,
    COALESCE((
      SELECT ROUND(AVG(r.score)::numeric / 2.0, 2)
      FROM portal.ratings r
      JOIN portal.demand_operators dop ON dop.demand_id = r.demand_id
      WHERE r.client_slug = p_slug
        AND dop.operator_id = o.id
    ), 0.00)             AS rating_avg,
    COALESCE((
      SELECT count(*)::int
      FROM portal.ratings r
      JOIN portal.demand_operators dop ON dop.demand_id = r.demand_id
      WHERE r.client_slug = p_slug
        AND dop.operator_id = o.id
    ), 0)                AS rating_count,
    ta.assigned_at,
    ta.notes
  FROM portal.team_assignments ta
  JOIN portal.operators o ON o.id = ta.operator_id
  JOIN portal.positions p ON p.id = ta.position_id
  WHERE ta.client_slug = p_slug
  ORDER BY p.sort_order, o.name;
$$;

GRANT EXECUTE ON FUNCTION portal.get_student_team(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal.get_student_team(text) FROM anon;

COMMENT ON FUNCTION portal.get_student_team IS
  'Equipe atribuída ao aluno. rating_avg é a média (escala 0..5) das avaliações do CLIENTE a este operador especificamente, via demand_operators. user_id é alias de operator_id por compat.';

-- ============================================================================
-- Fim 025_contracted_positions_and_rating_per_operator.sql
-- ============================================================================
