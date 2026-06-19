-- 079: ação operacional do admin para resolver compras Hotmart não vinculadas.
-- Vincula uma compra órfã (client_slug NULL) a um aluno e, opcionalmente, renova o
-- plano pela MESMA régua da Hotmart (access_until = charged_at + 30). Reusa
-- _extend_services_access + recalc_subscription_from_services. Guard is_admin.
-- (Aplicada no remoto via apply_migration.)
create or replace function portal.admin_link_hotmart_purchase(
  p_transaction_code text,
  p_client_slug text,
  p_renew boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'portal'
as $function$
declare
  v_purchase portal.hotmart_purchases;
  v_caller uuid;
  v_access date;
  v_n int := 0;
begin
  if not portal.is_admin() then
    raise exception 'Apenas admin pode vincular compras.' using errcode = '42501';
  end if;
  if p_client_slug is null or not exists (select 1 from portal.clients where slug = p_client_slug) then
    raise exception 'Aluno inválido.';
  end if;

  select * into v_purchase from portal.hotmart_purchases where transaction_code = p_transaction_code;
  if v_purchase.transaction_code is null then
    raise exception 'Compra não encontrada.';
  end if;

  select id into v_caller from portal.users where auth_user_id = auth.uid();

  update portal.hotmart_purchases
     set client_slug = p_client_slug
   where transaction_code = p_transaction_code;

  if p_renew then
    v_access := (v_purchase.charged_at::date) + 30;
    -- estende o plano inteiro (serviços active/delinquent) à régua da compra
    v_n := portal._extend_services_access(
      p_client_slug, '{}'::uuid[], true, v_purchase.charged_at::date, 1, v_access
    );
    perform portal.recalc_subscription_from_services(p_client_slug);
  end if;

  insert into portal.audit_log (event, user_id, identifier, metadata)
  values ('hotmart_purchase_linked', v_caller, p_transaction_code,
          jsonb_build_object('client_slug', p_client_slug, 'renew', p_renew,
            'services_updated', v_n, 'amount', v_purchase.amount,
            'buyer_email', v_purchase.buyer_email, 'new_access_until', v_access));

  return jsonb_build_object('ok', true, 'client_slug', p_client_slug, 'renewed', p_renew,
    'services_updated', v_n, 'new_access_until', v_access);
end;
$function$;

revoke all on function portal.admin_link_hotmart_purchase(text, text, boolean) from public, anon;
grant execute on function portal.admin_link_hotmart_purchase(text, text, boolean) to authenticated;
