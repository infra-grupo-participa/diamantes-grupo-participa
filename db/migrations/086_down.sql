-- 086_down — reversão da 086_demand_assignee_sync_state.
-- Uso: só em incidente/rollback deliberado. DESTRUTIVO (dropa coluna com dado) —
-- exige confirmação do usuário antes de rodar em produção. NÃO faz parte do fluxo
-- numerado de `supabase db push` — script avulso, rodar manualmente (psql/MCP) fora
-- de uma migration sequencial.
--
--
-- Ordem inversa da 086: função → índice → config → view → colunas.

-- ── reverte A4: RPC volta a não existir (a 059 continua com _resync_demand_assignees) ──
DROP FUNCTION IF EXISTS portal.admin_resolve_assignee_divergence(uuid, text);

-- ── reverte A2b: índice parcial da fila de pendências ───────────────────────
DROP INDEX IF EXISTS portal.idx_demands_assignee_pending;

-- ── reverte A3: chaves de config (só as introduzidas por esta migration) ───
DELETE FROM portal.clickup_config
 WHERE key IN ('assignee_strategy', 'space_multi_assignee_cache', 'guest_clickup_ids_cache', 'assignee_alert_email');

-- ── reverte A2: v_demands volta à forma da 077 (sem as 2 colunas de sync) ──
DROP VIEW IF EXISTS portal.v_demands;
CREATE VIEW portal.v_demands AS
 SELECT d.id, d.client_slug, c.display_name AS client_name, d.title, d.description,
    d.status, d.starts_at, d.ends_at, d.clickup_task_id, d.finalized_at, d.created_at,
    d.updated_at, d.service_type, d.briefing_status,
    (SELECT u.name FROM portal.users u WHERE u.id = d.created_by) AS created_by_name,
    (SELECT count(*) FROM portal.demand_operators dop WHERE dop.demand_id = d.id) AS operators_total,
    (SELECT count(*) FROM portal.demand_messages dmsg WHERE dmsg.demand_id = d.id) AS messages_count,
    (SELECT max(dmsg2.created_at) FROM portal.demand_messages dmsg2 WHERE dmsg2.demand_id = d.id) AS last_message_at,
    d.project_id,
    (SELECT p.title FROM portal.projects p WHERE p.id = d.project_id) AS project_title,
    (SELECT dmsg3.content FROM portal.demand_messages dmsg3 WHERE dmsg3.demand_id = d.id ORDER BY dmsg3.created_at DESC LIMIT 1) AS last_message_preview,
    (SELECT CASE WHEN u3.role IS NULL OR u3.role <> 'user' THEN 'team' ELSE 'client' END
       FROM portal.demand_messages dmsg4 LEFT JOIN portal.users u3 ON u3.id = dmsg4.user_id
      WHERE dmsg4.demand_id = d.id ORDER BY dmsg4.created_at DESC LIMIT 1) AS last_message_from
   FROM portal.demands d
   JOIN portal.clients c ON c.slug = d.client_slug;
GRANT SELECT ON portal.v_demands TO authenticated, service_role;

-- ── reverte A1b/A1: DESTRUTIVO — apaga clickup_delivery/_at e clickup_assignee_*.
-- Confirme com o usuário antes de descomentar e rodar. Comentado de propósito.
-- ALTER TABLE portal.demand_operators
--   DROP COLUMN IF EXISTS clickup_delivery,
--   DROP COLUMN IF EXISTS clickup_delivery_at;
-- ALTER TABLE portal.demands
--   DROP COLUMN IF EXISTS clickup_assignee_sync,
--   DROP COLUMN IF EXISTS clickup_assignee_detail;
