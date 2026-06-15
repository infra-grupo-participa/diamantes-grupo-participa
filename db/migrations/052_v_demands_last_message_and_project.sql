-- 052_v_demands_last_message_and_project
-- Expõe last_message_at (ordenar por atividade + não-lidas), project_id e project_title
-- (chip do projeto na demanda). Colunas novas ao FINAL (CREATE OR REPLACE preserva ordem).
-- Aplicada via MCP em npqyvjhvtfahuxfmuhie.
CREATE OR REPLACE VIEW portal.v_demands AS
 SELECT d.id,
    d.client_slug,
    c.display_name AS client_name,
    d.title,
    d.description,
    d.status,
    d.starts_at,
    d.ends_at,
    d.clickup_task_id,
    d.finalized_at,
    d.created_at,
    d.updated_at,
    d.service_type,
    d.briefing_status,
    ( SELECT u.name FROM portal.users u WHERE u.id = d.created_by) AS created_by_name,
    ( SELECT count(*) AS count FROM portal.demand_operators dop WHERE dop.demand_id = d.id) AS operators_total,
    ( SELECT count(*) AS count FROM portal.demand_members dm
       WHERE dm.demand_id = d.id AND dm.role = 'operator'::text AND dm.approved_finish) AS operators_approved,
    ( SELECT count(*) AS count FROM portal.demand_messages dmsg WHERE dmsg.demand_id = d.id) AS messages_count,
    ( SELECT max(dmsg2.created_at) FROM portal.demand_messages dmsg2 WHERE dmsg2.demand_id = d.id) AS last_message_at,
    d.project_id,
    ( SELECT p.title FROM portal.projects p WHERE p.id = d.project_id) AS project_title
   FROM portal.demands d
     JOIN portal.clients c ON c.slug = d.client_slug;
