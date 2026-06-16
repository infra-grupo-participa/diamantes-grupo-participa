-- B2 (SEGURANÇA — APLICAR SÓ DEPOIS DO DEPLOY DO APP). NÃO aplicada via MCP de propósito.
--
-- FURO ATUAL: portal.handle_new_auth_user() confia no `role` enviado pelo NAVEGADOR
-- (raw_user_meta_data->>'role'); um signUp público com role='admin' nasce admin/approved.
-- Qualquer pessoa com a anon key poderia se autopromover a administrador.
--
-- CORREÇÃO: todo novo usuário do Auth nasce SEMPRE role='user', status='pending'.
-- A promoção a admin/operator e a aprovação passam a ser feitas EXPLICITAMENTE pelo
-- backend (service role) DEPOIS de criar a conta — nunca derivadas do navegador.
--
-- ⚠️ ORDEM DE DEPLOY OBRIGATÓRIA (a inversão quebra a criação de usuários em silêncio):
--   1) Subir o app novo na Hostinger — as rotas server-side passam a gravar
--      role/status/client_slug explicitamente (não dependem mais do gatilho).
--   2) SÓ ENTÃO aplicar esta migration (apply_migration ou psql no remoto).
-- Enquanto o app antigo estiver no ar, este gatilho endurecido faria todo novo
-- cliente/admin nascer 'pending'. Por isso ela fica como ARQUIVO até o deploy.

create or replace function portal.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path to 'portal', 'public'
as $$
declare
  v_name  text;
  v_email text;
begin
  v_name  := coalesce(new.raw_user_meta_data->>'name', '');
  v_email := coalesce(new.email, '');

  -- NUNCA derivar privilégio do metadata do navegador.
  insert into portal.users (auth_user_id, email, name, role, status)
  values (new.id, v_email, v_name, 'user', 'pending')
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

comment on function portal.handle_new_auth_user() is
  'B2: cria portal.users ao inserir em auth.users SEMPRE como user/pending. Promoção a admin/operator/approved é explícita no backend (service role) — nunca via metadata do navegador.';
