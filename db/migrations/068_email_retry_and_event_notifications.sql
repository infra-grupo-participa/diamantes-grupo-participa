-- D1: retry/dead-letter de e-mail (colunas no email_log existente — sem tabela nova).
-- D2: notificações por evento (status genérico + chat ao cliente) com dedup atômico.
-- (Aplicada no remoto via apply_migration.)

alter table portal.email_log
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists next_attempt_at timestamptz;

create unique index if not exists email_log_dedup_key_uniq
  on portal.email_log(dedup_key) where dedup_key is not null;

create or replace function portal._notify_demand_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'portal','public','vault','net','pg_catalog'
as $$
declare
  v_key  text;
  v_body jsonb;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'clickup_sync_internal_key';
  if v_key is null then
    raise warning 'internal key ausente — e-mail de status ignorado';
    return new;
  end if;

  if new.status = 'review' and old.status is distinct from 'review' then
    v_body := jsonb_build_object('type','demanda_em_revisao','demand_id',new.id,'stamp', extract(epoch from clock_timestamp())::text);
  elsif new.status = 'done' and old.status is distinct from 'done' then
    v_body := jsonb_build_object('type','demanda_concluida','demand_id',new.id);
  elsif new.status = 'canceled' and old.status is distinct from 'canceled' then
    v_body := jsonb_build_object('type','demanda_cancelada','demand_id',new.id);
  elsif new.status = 'in_progress' and old.status = 'review' then
    v_body := jsonb_build_object('type','demanda_ajustes','demand_id',new.id,'stamp', extract(epoch from clock_timestamp())::text);
  else
    return new;
  end if;

  perform net.http_post(
    url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type','application/json','x-internal-key', v_key),
    body    := v_body,
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

drop trigger if exists demand_email_em_revisao on portal.demands;
drop trigger if exists demand_email_status_change on portal.demands;
create trigger demand_email_status_change
  after update of status on portal.demands
  for each row when (old.status is distinct from new.status)
  execute function portal._notify_demand_status_change();

create or replace function portal._notify_nova_mensagem()
returns trigger
language plpgsql
security definer
set search_path to 'portal','public','vault','net','pg_catalog'
as $$
declare
  v_key text;
begin
  if new.origin = 'clickup' then
    return new;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'clickup_sync_internal_key';
  if v_key is null then
    raise warning 'internal key ausente — e-mail nova_mensagem ignorado';
    return new;
  end if;
  perform net.http_post(
    url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type','application/json','x-internal-key', v_key),
    body    := jsonb_build_object('type','nova_mensagem','message_id', new.id),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

drop trigger if exists messages_email_notify on portal.demand_messages;
create trigger messages_email_notify
  after insert on portal.demand_messages
  for each row execute function portal._notify_nova_mensagem();

create or replace function portal._retry_failed_emails()
returns void
language plpgsql
security definer
set search_path to 'portal','public','vault','net','pg_catalog'
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'clickup_sync_internal_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type','application/json','x-internal-key', v_key),
    body    := jsonb_build_object('type','retry_failed'),
    timeout_milliseconds := 25000
  );
end;
$$;

-- select cron.schedule('retry-failed-emails','*/5 * * * *', $$select portal._retry_failed_emails();$$);
