-- 063_notify_demanda_em_revisao
-- Quando a equipe FINALIZA a demanda (status → 'review', tipicamente vindo do ClickUp
-- "em revisão" via webhook), o cliente precisa aprovar — mas não tinha aviso proativo.
-- Este trigger dispara o e-mail "pronta para sua aprovação" (Edge Function send-email,
-- type='demanda_em_revisao'). O `stamp` (clock_timestamp) dedupa a MESMA transição
-- (retries do pg_net) sem bloquear revisões futuras (pedir ajustes → refinalizar → review).
CREATE OR REPLACE FUNCTION portal._notify_demanda_em_revisao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public', 'vault', 'net', 'pg_catalog'
AS $function$
DECLARE v_internal_key text;
BEGIN
  SELECT decrypted_secret INTO v_internal_key
  FROM vault.decrypted_secrets WHERE name = 'clickup_sync_internal_key';
  IF v_internal_key IS NULL THEN
    RAISE WARNING 'internal key ausente — e-mail demanda_em_revisao ignorado';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_internal_key),
    body    := jsonb_build_object('type', 'demanda_em_revisao', 'demand_id', NEW.id, 'stamp', clock_timestamp()::text),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS demand_email_em_revisao ON portal.demands;
CREATE TRIGGER demand_email_em_revisao
  AFTER UPDATE OF status ON portal.demands
  FOR EACH ROW
  WHEN (NEW.status = 'review' AND OLD.status IS DISTINCT FROM 'review')
  EXECUTE FUNCTION portal._notify_demanda_em_revisao();
