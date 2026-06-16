-- Auditoria: funções internas (gatilho/cron) não devem ser chamáveis via PostgREST
-- por anon/authenticated. O pg_cron e os triggers rodam como owner (SECURITY DEFINER),
-- então revogar EXECUTE de public/anon/authenticated não as afeta — só fecha a porta
-- de um usuário logado invocá-las para disparar e-mails/reprocessamento.
-- (Aplicada no remoto via apply_migration.)
revoke execute on function portal._notify_demand_status_change() from public, anon, authenticated;
revoke execute on function portal._notify_nova_mensagem() from public, anon, authenticated;
revoke execute on function portal._retry_failed_emails() from public, anon, authenticated;
revoke execute on function portal._retry_unsynced_message_attachments() from public, anon, authenticated;
revoke execute on function portal._notify_expiring_services() from public, anon, authenticated;
