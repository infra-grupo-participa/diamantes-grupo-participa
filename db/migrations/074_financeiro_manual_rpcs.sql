-- Harmonização: recálculo + money_summary usam COALESCE(services.monthly_value, oferta)
-- e contam serviços manuais com valor. Conjunto contado = "serviços com valor" → MRR inalterado.
-- + RPCs do financeiro manual (pagamento, adiantamento, acordo, parcela, fonte).
-- (Aplicada no remoto via apply_migration.)

create or replace function portal.recalc_subscription_from_services(p_client_slug text)
returns jsonb language plpgsql security definer set search_path to 'portal'
as $function$
declare
  v_next_billing date; v_mrr numeric; v_min_access date;
  v_active_count int; v_delinq_count int; v_expired_count int;
  v_new_status text; v_margin date := (current_date - interval '3 days')::date;
begin
  select
    count(*) filter (where s.status='active'),
    count(*) filter (where s.status='delinquent'),
    count(*) filter (where s.status='active' and s.access_until is not null and s.access_until < v_margin),
    min(s.access_until) filter (where s.status='active'),
    coalesce(sum(coalesce(s.monthly_value, o.monthly_value)) filter (where s.status in ('active','delinquent')), 0)
  into v_active_count, v_delinq_count, v_expired_count, v_min_access, v_mrr
  from portal.services s
  left join portal.hotmart_offers o on o.offer_code = s.offer_code
  where s.client_slug = p_client_slug
    and coalesce(s.monthly_value, o.monthly_value) is not null;

  if v_active_count = 0 and v_delinq_count = 0 then
    v_new_status := 'canceled'; v_next_billing := null;
  elsif v_active_count = 0 or (v_active_count = v_expired_count and v_delinq_count > 0) then
    v_new_status := 'overdue'; v_next_billing := v_min_access;
  elsif v_delinq_count > 0 or v_expired_count > 0 then
    v_new_status := 'partial'; v_next_billing := v_min_access;
  else
    v_new_status := 'paid'; v_next_billing := v_min_access;
  end if;

  update portal.subscriptions
     set monthly_value=v_mrr, next_billing_date=v_next_billing, status=v_new_status, updated_at=now()
   where client_slug = p_client_slug;

  return jsonb_build_object('ok',true,'client_slug',p_client_slug,'active_count',v_active_count,
    'delinquent_count',v_delinq_count,'expired_count',v_expired_count,
    'next_billing_date',v_next_billing,'monthly_value',v_mrr,'status',v_new_status);
end;
$function$;

create or replace function portal.admin_money_summary()
returns table (mrr numeric, late numeric, on_time numeric, avg_ticket numeric,
               active_services integer, overdue_services integer, clients_overdue integer)
language plpgsql security invoker set search_path = portal, public
as $$
begin
  if not portal.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return query
  with svc as (
    select s.client_slug, s.access_until, coalesce(s.monthly_value, o.monthly_value, 0) as mv
    from portal.services s
    left join portal.hotmart_offers o on o.offer_code = s.offer_code
    where s.status in ('active','delinquent')
      and coalesce(s.monthly_value, o.monthly_value) is not null
  )
  select coalesce(sum(mv),0)::numeric,
    coalesce(sum(mv) filter (where access_until < current_date),0)::numeric,
    coalesce(sum(mv) filter (where access_until >= current_date),0)::numeric,
    (coalesce(sum(mv),0) / nullif(count(distinct client_slug),0))::numeric,
    count(*)::integer,
    count(*) filter (where access_until < current_date)::integer,
    count(distinct client_slug) filter (where access_until < current_date)::integer
  from svc;
end;
$$;

-- process_hotmart_purchase: grava monthly_value + billing_source='hotmart' no serviço.
-- (corpo idêntico ao remoto; ver migration aplicada 074 / função no banco)

create or replace function portal._extend_services_access(p_client_slug text, p_service_ids uuid[], p_whole_plan boolean, p_paid_at date, p_months integer, p_new_access_until date)
returns integer language plpgsql security definer set search_path to 'portal'
as $$
declare v_count int := 0;
begin
  update portal.services s
  set access_until = case
        when p_new_access_until is not null then greatest(coalesce(s.access_until, p_paid_at), p_new_access_until)
        else (greatest(coalesce(s.access_until, p_paid_at), p_paid_at) + (coalesce(p_months,1) || ' months')::interval)::date
      end,
      status='active', canceled_at=null, updated_at=now()
  where s.client_slug = p_client_slug
    and ( (p_whole_plan and s.status in ('active','delinquent'))
          or (not p_whole_plan and s.id = any(p_service_ids)) );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function portal._extend_services_access(text, uuid[], boolean, date, integer, date) from public, anon, authenticated;

-- register_manual_payment / create_agreement / settle_installment / set_service_billing_source:
-- ver corpos na migration aplicada no remoto (074). Guardas: portal.is_admin().
-- grants: execute para authenticated (todas guardadas por is_admin).
