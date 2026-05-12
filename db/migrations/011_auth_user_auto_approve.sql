-- ============================================================================
-- 011_auth_user_auto_approve.sql
-- Trigger: novos auth users com role=operator|admin entram como approved.
-- ----------------------------------------------------------------------------
-- Contexto: quando o admin cria um funcionário via UI (admin-api.js
-- createEmployee), o INSERT em portal.users já passa status='approved'.
-- Porém, se o auth user for criado diretamente no Supabase dashboard (sem
-- passar pela UI), nenhuma linha é criada em portal.users — o usuário fica
-- órfão e, ao tentar logar, o perfil não é encontrado, resultando em bloqueio.
--
-- Esta migration cria um trigger em auth.users que, ao INSERT de novo usuário:
--   - se raw_user_meta_data->>'role' IN ('operator','admin'):
--       insere portal.users com status='approved'
--   - se role = 'user' (ou ausente):
--       insere portal.users com status='pending' (fluxo normal de clientes)
--
-- Isso garante que operadores/admins criados por qualquer caminho já nascem
-- com acesso liberado.
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal', 'public'
AS $$
DECLARE
  v_role   text;
  v_status text;
  v_name   text;
  v_email  text;
BEGIN
  v_role  := COALESCE(NEW.raw_user_meta_data->>'role',   'user');
  v_name  := COALESCE(NEW.raw_user_meta_data->>'name',   '');
  v_email := COALESCE(NEW.email, '');

  -- Operadores e admins: aprovados automaticamente
  -- Demais (clientes, role ausente): pendentes até aprovação manual
  IF v_role IN ('operator', 'admin') THEN
    v_status := 'approved';
  ELSE
    v_status := 'pending';
  END IF;

  -- Idempotente: só insere se ainda não existe linha para este auth_user_id
  INSERT INTO portal.users (auth_user_id, email, name, role, status)
  VALUES (NEW.id, v_email, v_name, v_role, v_status)
  ON CONFLICT (auth_user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Trigger dispara após INSERT em auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION portal.handle_new_auth_user();

COMMENT ON FUNCTION portal.handle_new_auth_user IS
  'Cria linha em portal.users ao inserir em auth.users. role=operator|admin → status=approved; demais → status=pending.';

-- ============================================================================
-- Fim 011_auth_user_auto_approve.sql
-- ============================================================================
