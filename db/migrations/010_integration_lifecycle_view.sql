-- ============================================================================
-- 010_integration_lifecycle_view.sql
-- View v_demand_lifecycle: visão consolidada do ciclo de vida de uma demanda.
-- ----------------------------------------------------------------------------
-- Por linha (demanda) inclui:
--   - dados básicos da demanda + cliente + criador
--   - status_log[]            jsonb agregado das transições
--   - client_rating           jsonb da avaliação do cliente (ou null)
--   - operator_ratings[]      jsonb agregado das avaliações reversas
--   - points_awarded[]        jsonb agregado dos pontos gerados
--   - members[]               jsonb agregado dos membros (operadores + cliente)
--   - messages_count          total de mensagens trocadas
--   - first_message_at / last_message_at
--
-- security_invoker = on: respeita RLS das tabelas-base. Admin vê todas as
-- demandas, cliente vê só as do próprio client_slug, operador vê só onde
-- está em demand_members (mesma regra do v_my_assigned_demands).
-- ----------------------------------------------------------------------------
-- Dependências:
--   - 006 (operator_to_client_ratings, demand_status_log, operator_points,
--     ratings.demand_id+status+submitted_at)
--   - 008 (triggers que populam tudo isso)
-- ============================================================================

CREATE OR REPLACE VIEW portal.v_demand_lifecycle
WITH (security_invoker = on)
AS
SELECT
  d.id                        AS demand_id,
  d.client_slug,
  c.display_name              AS client_display_name,
  d.title,
  d.description,
  d.status,
  d.starts_at,
  d.ends_at,
  d.finalized_at,
  d.clickup_task_id,
  d.created_at,
  d.updated_at,
  d.created_by,
  cb.name                     AS created_by_name,

  -- Membros (cliente + operadores)
  (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id',         dm.user_id,
      'role',            dm.role,
      'approved_finish', dm.approved_finish,
      'approved_at',     dm.approved_at,
      'added_at',        dm.added_at,
      'name',            u.name,
      'email',           u.email
    ) ORDER BY dm.role, u.name), '[]'::jsonb)
    FROM portal.demand_members dm
    JOIN portal.users u ON u.id = dm.user_id
    WHERE dm.demand_id = d.id
  ) AS members,

  -- Histórico de status
  (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'from_status', l.from_status,
      'to_status',   l.to_status,
      'by_user_id',  l.by_user_id,
      'by_name',     lu.name,
      'changed_at',  l.changed_at
    ) ORDER BY l.changed_at), '[]'::jsonb)
    FROM portal.demand_status_log l
    LEFT JOIN portal.users lu ON lu.id = l.by_user_id
    WHERE l.demand_id = d.id
  ) AS status_log,

  -- Avaliação do cliente (mais recente)
  (
    SELECT jsonb_build_object(
      'id',           r.id,
      'score',        r.score,
      'comment',      r.comment,
      'status',       r.status,
      'submitted_at', r.submitted_at,
      'created_at',   r.created_at,
      'by_user_id',   r.user_id,
      'by_name',      ru.name
    )
    FROM portal.ratings r
    LEFT JOIN portal.users ru ON ru.id = r.user_id
    WHERE r.demand_id = d.id
    ORDER BY r.created_at DESC
    LIMIT 1
  ) AS client_rating,

  -- Avaliações reversas (operador → cliente)
  (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',           ocr.id,
      'operator_id',  ocr.operator_id,
      'operator_name',ou.name,
      'score',        ocr.score,
      'comment',      ocr.comment,
      'dimensions',   ocr.dimensions,
      'status',       ocr.status,
      'submitted_at', ocr.submitted_at,
      'created_at',   ocr.created_at
    ) ORDER BY ocr.created_at), '[]'::jsonb)
    FROM portal.operator_to_client_ratings ocr
    LEFT JOIN portal.users ou ON ou.id = ocr.operator_id
    WHERE ocr.demand_id = d.id
  ) AS operator_ratings,

  -- Pontos gerados a partir desta demanda
  (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id',    op.user_id,
      'user_name',  ou.name,
      'points',     op.points,
      'reason',     op.reason,
      'created_at', op.created_at
    ) ORDER BY op.created_at), '[]'::jsonb)
    FROM portal.operator_points op
    LEFT JOIN portal.users ou ON ou.id = op.user_id
    WHERE op.demand_id = d.id
  ) AS points_awarded,

  -- Métricas de mensagens
  (SELECT COUNT(*)::int FROM portal.demand_messages m WHERE m.demand_id = d.id) AS messages_count,
  (SELECT MIN(m.created_at) FROM portal.demand_messages m WHERE m.demand_id = d.id) AS first_message_at,
  (SELECT MAX(m.created_at) FROM portal.demand_messages m WHERE m.demand_id = d.id) AS last_message_at

FROM portal.demands d
JOIN portal.clients c ON c.slug = d.client_slug
LEFT JOIN portal.users cb ON cb.id = d.created_by;

GRANT SELECT ON portal.v_demand_lifecycle TO authenticated;

COMMENT ON VIEW portal.v_demand_lifecycle IS 'Visão consolidada do ciclo de vida de cada demanda: status_log + ratings (ambas direções) + pontos + membros + mensagens. security_invoker=on respeita RLS das tabelas-base.';

-- ============================================================================
-- Fim 010_integration_lifecycle_view.sql
-- ============================================================================
