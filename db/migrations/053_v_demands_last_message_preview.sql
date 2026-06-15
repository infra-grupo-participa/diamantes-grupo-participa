-- 053_v_demands_last_message_preview
-- Preview da última mensagem (snippet na lista) + de quem é ('team'|'client', p/ refinar
-- não-lidas: só conta como não-lida quando a ÚLTIMA é da equipe). Append no fim da view.
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
    ( SELECT p.title FROM portal.projects p WHERE p.id = d.project_id) AS project_title,
    ( SELECT dmsg3.content FROM portal.demand_messages dmsg3
       WHERE dmsg3.demand_id = d.id ORDER BY dmsg3.created_at DESC LIMIT 1) AS last_message_preview,
    ( SELECT CASE WHEN u3.role IS NULL OR u3.role <> 'user' THEN 'team' ELSE 'client' END
       FROM portal.demand_messages dmsg4
       LEFT JOIN portal.users u3 ON u3.id = dmsg4.user_id
       WHERE dmsg4.demand_id = d.id ORDER BY dmsg4.created_at DESC LIMIT 1) AS last_message_from
   FROM portal.demands d
     JOIN portal.clients c ON c.slug = d.client_slug;
