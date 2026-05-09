-- Diamantes Portal — schema initial migration
--
-- Project: npqyvjhvtfahuxfmuhie (Serviços Diamante)
-- Schema:  portal (isolated from `public` which hosts the Digisac bot)
--
-- HOW TO APPLY (1x manual):
--   1. Abra https://supabase.com/dashboard/project/npqyvjhvtfahuxfmuhie/sql/new
--   2. Cole TODO este arquivo
--   3. Execute (Run)
--   4. Em Settings → API → "Exposed schemas", adicione `portal` ao lado de `public`
--      (campo aceita lista separada por vírgula: `public, portal`)
--   5. Aguarde ~30s pro PostgREST recarregar o schema cache
--
-- Após isso, o PHP backend acessa via header `Accept-Profile: portal`.
-- Schema isolado: ZERO impacto nas tabelas thb_* do bot Digisac no `public`.

create schema if not exists portal;

-- ─── Tabelas ────────────────────────────────────────────────────────────────

create table if not exists portal.clients (
  slug                  text primary key,
  display_name          text not null,
  cliente_name_var      text not null,
  cliente_task_id       text,
  cu_list_id            text default '901326399435',
  primary_color         text default '#F29725',
  css_card_bg           text default '#ffffff',
  dropdown_indent_quirk boolean default true,
  cf_tipos              jsonb not null default '[]',
  assignee_ids          jsonb not null default '{}',
  auto_map              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists portal.users (
  id              uuid primary key default gen_random_uuid(),
  legacy_id       text unique,
  email           text not null unique,
  name            text not null,
  password_hash   text not null default '',
  role            text not null default 'user'  check (role   in ('user', 'admin')),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'disabled')),
  client_slug     text references portal.clients(slug) on delete set null,
  document_type   text,
  document_value  text,
  cpf             text,
  metadata        jsonb default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_login_at   timestamptz
);

create index if not exists idx_users_email   on portal.users(email);
create index if not exists idx_users_legacy  on portal.users(legacy_id);
create index if not exists idx_users_client  on portal.users(client_slug);

create table if not exists portal.services (
  id           uuid primary key default gen_random_uuid(),
  client_slug  text not null references portal.clients(slug) on delete cascade,
  service_type text not null,
  status       text not null default 'active',
  metadata     jsonb default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_slug, service_type)
);

create index if not exists idx_services_client on portal.services(client_slug);

create table if not exists portal.contract_status (
  client_slug   text not null references portal.clients(slug) on delete cascade,
  service_type  text not null,
  employee_name text not null,
  status        text not null default 'active',
  data          jsonb default '{}',
  updated_at    timestamptz not null default now(),
  primary key (client_slug, service_type, employee_name)
);

create table if not exists portal.ratings (
  id          uuid primary key default gen_random_uuid(),
  client_slug text not null references portal.clients(slug) on delete cascade,
  task_id     text not null,
  score       smallint not null check (score between 1 and 10),
  user_id     uuid references portal.users(id) on delete set null,
  comment     text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_ratings_client on portal.ratings(client_slug);
create index if not exists idx_ratings_task   on portal.ratings(task_id);

create table if not exists portal.task_reviews (
  id          uuid primary key default gen_random_uuid(),
  client_slug text not null references portal.clients(slug) on delete cascade,
  task_id     text not null,
  decision    text not null check (decision in ('approve', 'request_changes')),
  feedback    text,
  user_id     uuid references portal.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_task_reviews_client on portal.task_reviews(client_slug);
create index if not exists idx_task_reviews_task   on portal.task_reviews(task_id);

create table if not exists portal.client_profiles (
  client_slug text primary key references portal.clients(slug) on delete cascade,
  data        jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

create table if not exists portal.audit_log (
  id          bigserial primary key,
  event       text not null,
  user_id     uuid references portal.users(id) on delete set null,
  identifier  text,
  ip          text,
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_event   on portal.audit_log(event);
create index if not exists idx_audit_user    on portal.audit_log(user_id);
create index if not exists idx_audit_created on portal.audit_log(created_at desc);

create table if not exists portal.rate_limits (
  key        text primary key,
  attempts   bigint[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- ─── RLS — deny-all, server-side via service_role apenas ───────────────────

alter table portal.clients          enable row level security;
alter table portal.users            enable row level security;
alter table portal.services         enable row level security;
alter table portal.contract_status  enable row level security;
alter table portal.ratings          enable row level security;
alter table portal.task_reviews     enable row level security;
alter table portal.client_profiles  enable row level security;
alter table portal.audit_log        enable row level security;
alter table portal.rate_limits      enable row level security;

-- Sem policies = RLS bloqueia anon e authenticated. service_role bypass.
-- Frontend NÃO acessa Supabase direto — sempre via PHP backend.

-- ─── Trigger updated_at (search_path fixo, security definer) ──────────────

create or replace function portal.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = portal, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_clients_updated_at         on portal.clients;
drop trigger if exists trg_users_updated_at           on portal.users;
drop trigger if exists trg_services_updated_at        on portal.services;
drop trigger if exists trg_contract_status_updated_at on portal.contract_status;
drop trigger if exists trg_client_profiles_updated_at on portal.client_profiles;

create trigger trg_clients_updated_at         before update on portal.clients         for each row execute function portal.set_updated_at();
create trigger trg_users_updated_at           before update on portal.users           for each row execute function portal.set_updated_at();
create trigger trg_services_updated_at        before update on portal.services        for each row execute function portal.set_updated_at();
create trigger trg_contract_status_updated_at before update on portal.contract_status for each row execute function portal.set_updated_at();
create trigger trg_client_profiles_updated_at before update on portal.client_profiles for each row execute function portal.set_updated_at();

-- ─── Sanity check ──────────────────────────────────────────────────────────

select
  table_schema,
  table_name
from information_schema.tables
where table_schema = 'portal'
order by table_name;
