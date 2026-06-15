-- 047_fix_submit_base_briefing_empty_access
-- Corrige submit_base_briefing: clientes SEM serviços com acessos a preencher
-- (access = '{}') eram bloqueados indevidamente ("Preencha os acessos antes de enviar.").
-- A validação de campos obrigatórios já ocorre no front (validateBaseAccess); aqui só
-- garantimos a linha e marcamos como enviado. Aplicada via MCP em npqyvjhvtfahuxfmuhie.
CREATE OR REPLACE FUNCTION portal.submit_base_briefing()
RETURNS portal.client_briefing
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal','public'
AS $function$
DECLARE
  v_caller portal.users;
  v_row    portal.client_briefing;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
  IF v_caller.client_slug IS NULL THEN RAISE EXCEPTION 'Usuário sem cliente associado.'; END IF;

  -- Garante a linha (caso submit seja chamado sem um save anterior).
  INSERT INTO portal.client_briefing (client_slug, access, pending_flags)
  VALUES (v_caller.client_slug, '{}'::jsonb, '[]'::jsonb)
  ON CONFLICT (client_slug) DO NOTHING;

  UPDATE portal.client_briefing
  SET base_status = 'submitted', submitted_at = now(), updated_at = now()
  WHERE client_slug = v_caller.client_slug
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
