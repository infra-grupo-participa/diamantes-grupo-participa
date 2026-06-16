-- Harmonização Hotmart × manual: o SERVIÇO ganha valor e fonte próprios.
-- A régua (access_until) e o motor de recálculo passam a ser source-agnostic.
-- (Aplicada no remoto via apply_migration.)
alter table portal.services
  add column if not exists billing_source text not null default 'hotmart',
  add column if not exists monthly_value  numeric;

alter table portal.services drop constraint if exists services_billing_source_chk;
alter table portal.services add constraint services_billing_source_chk
  check (billing_source in ('hotmart','manual','courtesy'));

-- Backfill: valor canônico = valor da oferta Hotmart (mantém MRR idêntico).
update portal.services s
set monthly_value = o.monthly_value
from portal.hotmart_offers o
where o.offer_code = s.offer_code and s.monthly_value is null;

comment on column portal.services.billing_source is
  'Quem governa a cobrança: hotmart (auto via webhook) | manual (financeiro) | courtesy.';
comment on column portal.services.monthly_value is
  'Valor mensal canônico do serviço (independe da Hotmart). Recálculo usa COALESCE(monthly_value, oferta).';

create table if not exists portal.payments (
  id                       uuid primary key default gen_random_uuid(),
  client_slug              text not null references portal.clients(slug) on delete cascade,
  service_id               uuid references portal.services(id) on delete set null,
  amount                   numeric not null,
  method                   text,
  paid_at                  date not null default current_date,
  source                   text not null default 'manual',  -- manual|hotmart
  months                   integer not null default 1,
  agreement_installment_id uuid,
  notes                    text,
  created_by               uuid references portal.users(id),
  created_at               timestamptz not null default now()
);
create index if not exists idx_payments_client on portal.payments(client_slug, paid_at desc);

create table if not exists portal.payment_agreements (
  id           uuid primary key default gen_random_uuid(),
  client_slug  text not null references portal.clients(slug) on delete cascade,
  title        text not null,
  total_amount numeric not null default 0,
  status       text not null default 'active',  -- active|completed|canceled
  notes        text,
  created_by   uuid references portal.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_agreements_client on portal.payment_agreements(client_slug);

create table if not exists portal.agreement_installments (
  id           uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references portal.payment_agreements(id) on delete cascade,
  seq          integer not null,
  due_date     date not null,
  amount       numeric not null,
  status       text not null default 'pending',  -- pending|paid|canceled
  paid_at      date,
  payment_id   uuid references portal.payments(id) on delete set null,
  unique (agreement_id, seq)
);
create index if not exists idx_installments_agreement on portal.agreement_installments(agreement_id);

alter table portal.payments drop constraint if exists payments_installment_fk;
alter table portal.payments add constraint payments_installment_fk
  foreign key (agreement_installment_id) references portal.agreement_installments(id) on delete set null;

alter table portal.payments enable row level security;
alter table portal.payment_agreements enable row level security;
alter table portal.agreement_installments enable row level security;

drop policy if exists payments_admin_read on portal.payments;
create policy payments_admin_read on portal.payments for select using (portal.is_admin());
drop policy if exists agreements_admin_read on portal.payment_agreements;
create policy agreements_admin_read on portal.payment_agreements for select using (portal.is_admin());
drop policy if exists installments_admin_read on portal.agreement_installments;
create policy installments_admin_read on portal.agreement_installments for select using (portal.is_admin());
