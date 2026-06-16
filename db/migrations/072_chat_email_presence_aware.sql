-- Otimização de e-mail de chat: só notifica o cliente quando ele está AUSENTE.
-- Mecanismo: marcador de leitura no servidor + envio ADIADO (carência de 3 min);
-- se o cliente abriu/leu a demanda na janela, NÃO manda e-mail (viu in-app).
-- Reduz drasticamente o volume (some o "e-mail por mensagem" de quem está online).
-- DORMENTE: o cron NÃO é agendado aqui (e-mails de cliente seguem pausados).
-- (Aplicada no remoto via apply_migration.)
--
-- PARA LIGAR (quando o dono autorizar e-mails ao cliente):
--   select cron.schedule('process-pending-chat-emails','*/2 * * * *',
--     $$select portal._process_pending_chat_emails();$$);
--   E mantenha o gatilho imediato messages_email_notify REMOVIDO (este worker o substitui).

create table if not exists portal.demand_reads (
  user_id      uuid not null references portal.users(id) on delete cascade,
  demand_id    uuid not null references portal.demands(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, demand_id)
);
alter table portal.demand_reads enable row level security;
-- sem policy → acesso direto negado; só as funções SECURITY DEFINER abaixo acessam.

create or replace function portal.mark_demand_read(p_demand_id uuid)
returns void
language plpgsql
security definer
set search_path to 'portal', 'public'
as $$
declare v_uid uuid;
begin
  select id into v_uid from portal.users where auth_user_id = auth.uid();
  if v_uid is null or p_demand_id is null then return; end if;
  insert into portal.demand_reads (user_id, demand_id, last_read_at)
  values (v_uid, p_demand_id, now())
  on conflict (user_id, demand_id) do update set last_read_at = now();
end;
$$;
grant execute on function portal.mark_demand_read(uuid) to authenticated;

alter table portal.demand_messages add column if not exists email_notified_at timestamptz;
update portal.demand_messages set email_notified_at = created_at where email_notified_at is null;

create or replace function portal._process_pending_chat_emails()
returns void
language plpgsql
security definer
set search_path to 'portal','public','vault','net','pg_catalog'
as $$
declare
  v_key  text;
  r      record;
  v_read timestamptz;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'clickup_sync_internal_key';
  if v_key is null then return; end if;

  for r in
    select m.id, m.demand_id, m.created_at, d.client_slug
    from portal.demand_messages m
    join portal.demands d on d.id = m.demand_id
    join portal.users  au on au.id = m.user_id
    where m.email_notified_at is null
      and coalesce(m.origin,'') <> 'clickup'
      and au.role <> 'user'
      and m.created_at < now() - interval '3 minutes'
      and m.created_at > now() - interval '1 day'
    order by m.created_at
    limit 50
  loop
    select max(dr.last_read_at) into v_read
    from portal.demand_reads dr
    join portal.users u on u.id = dr.user_id
    where dr.demand_id = r.demand_id and u.role = 'user' and u.client_slug = r.client_slug;

    if v_read is not null and v_read >= r.created_at then
      update portal.demand_messages set email_notified_at = now() where id = r.id;
    else
      perform net.http_post(
        url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/send-email',
        headers := jsonb_build_object('Content-Type','application/json','x-internal-key', v_key),
        body    := jsonb_build_object('type','nova_mensagem','message_id', r.id),
        timeout_milliseconds := 5000
      );
      update portal.demand_messages set email_notified_at = now() where id = r.id;
    end if;
  end loop;
end;
$$;
revoke execute on function portal._process_pending_chat_emails() from public, anon, authenticated;

drop trigger if exists messages_email_notify on portal.demand_messages;
