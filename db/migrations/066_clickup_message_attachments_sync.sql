-- E1: espelhar anexos do chat como ANEXOS BINÁRIOS no ClickUp.
-- Controle de idempotência por arquivo + flag de "tudo sincronizado", para
-- permitir retry seguro (dentro da Edge e via cron de varredura — rede de segurança).
-- (Aplicada no remoto via apply_migration.)

alter table portal.demand_messages
  add column if not exists clickup_attachments jsonb not null default '[]'::jsonb,
  add column if not exists clickup_attachments_synced_at timestamptz;

comment on column portal.demand_messages.clickup_attachments is
  'E1: mapa de anexos já enviados ao ClickUp: [{path, clickup_id}]. Usado para não reenviar em retry.';
comment on column portal.demand_messages.clickup_attachments_synced_at is
  'E1: marca quando TODOS os anexos da mensagem foram espelhados no ClickUp (null = pendente).';

-- Varredura (dead-letter): reprocessa mensagens com anexos ainda não sincronizados.
-- O pg_net é fire-and-forget (não re-dispara em erro), então o retry primário é
-- dentro da Edge; este cron é a rede de segurança para falhas totais.
create or replace function portal._retry_unsynced_message_attachments()
returns void
language plpgsql
security definer
set search_path to 'portal', 'public', 'vault', 'net', 'pg_catalog'
as $$
declare
  v_internal_key text;
  r record;
begin
  select decrypted_secret into v_internal_key
  from vault.decrypted_secrets where name = 'clickup_sync_internal_key';
  if v_internal_key is null then
    raise warning 'clickup_sync_internal_key ausente — varredura de anexos ignorada';
    return;
  end if;

  for r in
    select m.id
    from portal.demand_messages m
    join portal.demands d on d.id = m.demand_id
    where coalesce(jsonb_array_length(m.attachments), 0) > 0
      and m.clickup_attachments_synced_at is null
      and coalesce(m.origin, '') <> 'clickup'
      and d.clickup_task_id is not null
      and m.created_at > now() - interval '2 days'
    order by m.created_at
    limit 20
  loop
    perform net.http_post(
      url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/clickup-comment-sync',
      headers := jsonb_build_object('Content-Type','application/json','x-internal-key', v_internal_key),
      body    := jsonb_build_object('message_id', r.id),
      timeout_milliseconds := 8000
    );
  end loop;
end;
$$;

-- select cron.schedule('retry-clickup-attachments','*/10 * * * *',
--   $$select portal._retry_unsynced_message_attachments();$$);
