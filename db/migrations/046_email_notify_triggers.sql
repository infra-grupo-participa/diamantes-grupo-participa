-- 046_email_notify_triggers — notificações por e-mail (Resend) via pg_net → EF send-email.
-- Mesmo padrão das triggers do ClickUp (vault internal key + net.http_post).
-- Aplicada via MCP em npqyvjhvtfahuxfmuhie.

-- 1) Nova demanda → confirmação ao cliente
CREATE OR REPLACE FUNCTION portal._notify_demanda_criada()
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
    RAISE WARNING 'internal key ausente — e-mail demanda_criada ignorado';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type','application/json','x-internal-key',v_internal_key),
    body    := jsonb_build_object('type','demanda_criada','demand_id', NEW.id),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
END;
$$;

-- 2) Nova mensagem → aviso ao cliente (a EF decide: pula se autor é o cliente
--    ou se está dentro do cooldown).
CREATE OR REPLACE FUNCTION portal._notify_nova_mensagem()
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
    RAISE WARNING 'internal key ausente — e-mail nova_mensagem ignorado';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type','application/json','x-internal-key',v_internal_key),
    body    := jsonb_build_object('type','nova_mensagem','message_id', NEW.id),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS demands_email_notify  ON portal.demands;
CREATE TRIGGER demands_email_notify
  AFTER INSERT ON portal.demands
  FOR EACH ROW EXECUTE FUNCTION portal._notify_demanda_criada();

DROP TRIGGER IF EXISTS messages_email_notify ON portal.demand_messages;
CREATE TRIGGER messages_email_notify
  AFTER INSERT ON portal.demand_messages
  FOR EACH ROW EXECUTE FUNCTION portal._notify_nova_mensagem();
