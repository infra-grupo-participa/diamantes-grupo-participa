-- D3: aviso por e-mail de serviço expirando/próximo do vencimento.
-- Cron diário chama a edge function cron-service-expiry (marcos 7/3/1/0/-1 dias).
-- (Aplicada no remoto via apply_migration.)
create or replace function portal._notify_expiring_services()
returns void
language plpgsql
security definer
set search_path to 'portal','public','vault','net','pg_catalog'
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'clickup_sync_internal_key';
  if v_key is null then
    raise warning 'internal key ausente — aviso de expiração ignorado';
    return;
  end if;
  perform net.http_post(
    url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/cron-service-expiry',
    headers := jsonb_build_object('Content-Type','application/json','x-internal-key', v_key),
    body    := jsonb_build_object('source','cron'),
    timeout_milliseconds := 30000
  );
end;
$$;

-- select cron.schedule('notify-expiring-services','0 12 * * *', $$select portal._notify_expiring_services();$$);
