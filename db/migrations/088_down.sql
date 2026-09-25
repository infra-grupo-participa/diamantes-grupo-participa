-- 088_down — reversão da 088_assignee_alert_routing.
-- Uso: incidente/rollback deliberado. Não destrutivo (remove só a linha de config;
-- send-email volta sozinho ao fallback de todos os admins aprovados). NÃO faz parte
-- do fluxo numerado de `supabase db push` — script avulso, rodar manualmente
-- (psql/MCP) fora de uma migration sequencial.

DELETE FROM portal.clickup_config
 WHERE key = 'assignee_alert_to';
