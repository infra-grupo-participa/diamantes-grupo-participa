-- C1: sumario financeiro na granularidade de SERVICO (fonte da verdade).
-- Corrige a inadimplencia inflada (~75%): a tabela subscriptions agrega monthly_value
-- por cliente com status "pior caso"; somar o valor inteiro de quem esta `partial`
-- jogava no balde de atraso servicos que estao em dia. Aqui o atraso = soma so dos
-- servicos de fato vencidos (access_until < hoje).
-- SECURITY INVOKER + guarda is_admin(): nao vaza financeiro para aluno/operador logado.
-- (Aplicada no remoto via apply_migration.)
create or replace function portal.admin_money_summary()
returns table (
  mrr numeric,
  late numeric,
  on_time numeric,
  avg_ticket numeric,
  active_services integer,
  overdue_services integer,
  clients_overdue integer
)
language plpgsql
security invoker
set search_path = portal, public
as $$
begin
  if not portal.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with svc as (
    select s.client_slug,
           s.access_until,
           coalesce(o.monthly_value, 0) as mv
    from portal.services s
    left join portal.hotmart_offers o on o.offer_code = s.offer_code
    where s.status in ('active', 'delinquent')
      and s.offer_code is not null
      and s.offer_code <> ''
  )
  select
    coalesce(sum(mv), 0)::numeric,
    coalesce(sum(mv) filter (where access_until < current_date), 0)::numeric,
    coalesce(sum(mv) filter (where access_until >= current_date), 0)::numeric,
    (coalesce(sum(mv), 0) / nullif(count(distinct client_slug), 0))::numeric,
    count(*)::integer,
    count(*) filter (where access_until < current_date)::integer,
    count(distinct client_slug) filter (where access_until < current_date)::integer
  from svc;
end;
$$;

grant execute on function portal.admin_money_summary() to authenticated;

comment on function portal.admin_money_summary() is
  'C1: agregados financeiros por servico (MRR, atraso real, em dia, ticket medio). INVOKER + is_admin().';
