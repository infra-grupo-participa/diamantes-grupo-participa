-- 078: carimba users.last_login_at no login (corrige KPI "Ativos hoje" congelado).
-- Nada atualizava last_login_at → o KPI ficava sempre ~0. RPC SECURITY DEFINER que
-- atualiza a linha do próprio usuário autenticado; chamada pelo login-form após o
-- sign-in aprovado. (Aplicada no remoto via apply_migration.)
create or replace function portal.touch_my_last_login()
returns void
language plpgsql
security definer
set search_path to 'portal','public'
as $function$
begin
  update portal.users set last_login_at = now(), updated_at = now()
   where auth_user_id = auth.uid();
end; $function$;

revoke all on function portal.touch_my_last_login() from public;
grant execute on function portal.touch_my_last_login() to authenticated;
