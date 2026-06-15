-- 050_email_projeto_criado_drop_nova_mensagem
-- E-mail só pra: criação de demanda (já existe), criação de PROJETO (novo) e
-- redefinição de senha (Auth SMTP, separado). Remove o de NOVA MENSAGEM — o ClickUp
-- já notifica mensagens. Aplicada via MCP em npqyvjhvtfahuxfmuhie.

-- 1) Remove o disparo de nova mensagem
DROP TRIGGER IF EXISTS messages_email_notify ON portal.demand_messages;
DROP FUNCTION IF EXISTS portal._notify_nova_mensagem();

-- 2) Adiciona o disparo de projeto criado
CREATE OR REPLACE FUNCTION portal._notify_projeto_criado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal','public','vault','net','pg_catalog'
AS $$
DECLARE
  v_internal_key text;
BEGIN
  SELECT decrypted_secret INTO v_internal_key
  FROM vault.decrypted_secrets WHERE name = 'clickup_sync_internal_key';
  IF v_internal_key IS NULL THEN
    RAISE WARNING 'internal key ausente — e-mail projeto_criado ignorado';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type','application/json','x-internal-key',v_internal_key),
    body    := jsonb_build_object('type','projeto_criado','project_id', NEW.id),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_email_notify ON portal.projects;
CREATE TRIGGER projects_email_notify
  AFTER INSERT ON portal.projects
  FOR EACH ROW EXECUTE FUNCTION portal._notify_projeto_criado();
