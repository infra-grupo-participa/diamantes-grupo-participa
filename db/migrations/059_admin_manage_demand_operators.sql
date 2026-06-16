-- 059_admin_manage_demand_operators
-- Permite ao ADMIN adicionar/remover operadores de uma demanda JÁ ABERTA
-- (portal.demand_operators). Isso reflete nas métricas de performance (o operador
-- passa a contar na demanda) e re-sincroniza os assignees no ClickUp — que é como
-- o operador recebe a notificação. A edge clickup-sync já faz o diff add/rem de
-- assignees para uma tarefa existente; aqui só a disparamos via pg_net (mesmo padrão
-- de _sync_demand_to_clickup), apenas no fluxo admin (não na criação normal).

-- Helper: dispara o re-sync de assignees no ClickUp (best-effort).
CREATE OR REPLACE FUNCTION portal._resync_demand_assignees(p_demand_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public', 'vault', 'net', 'pg_catalog'
AS $function$
DECLARE v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'clickup_sync_internal_key';
  IF v_key IS NULL THEN
    RAISE WARNING 'clickup_sync_internal_key não encontrado — resync de assignees ignorado';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := 'https://npqyvjhvtfahuxfmuhie.supabase.co/functions/v1/clickup-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_key),
    body    := jsonb_build_object('demand_id', p_demand_id, 'event', 'UPDATE:demand_operators'),
    timeout_milliseconds := 5000
  );
END;
$function$;

-- Adicionar operador à demanda.
CREATE OR REPLACE FUNCTION portal.admin_add_demand_operator(p_demand_id uuid, p_operator_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public'
AS $function$
DECLARE v_added boolean := false;
BEGIN
  IF NOT portal.is_admin() THEN RAISE EXCEPTION 'Apenas admin pode gerir operadores.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM portal.demands WHERE id = p_demand_id) THEN RAISE EXCEPTION 'Demanda não encontrada.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM portal.operators WHERE id = p_operator_id) THEN RAISE EXCEPTION 'Operador não encontrado.'; END IF;

  INSERT INTO portal.demand_operators (demand_id, operator_id, role)
  SELECT p_demand_id, p_operator_id, 'operator'
  WHERE NOT EXISTS (
    SELECT 1 FROM portal.demand_operators WHERE demand_id = p_demand_id AND operator_id = p_operator_id
  );
  v_added := FOUND;

  IF v_added THEN PERFORM portal._resync_demand_assignees(p_demand_id); END IF;
  RETURN jsonb_build_object('ok', true, 'added', v_added);
END;
$function$;

-- Remover operador da demanda.
CREATE OR REPLACE FUNCTION portal.admin_remove_demand_operator(p_demand_id uuid, p_operator_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public'
AS $function$
DECLARE v_removed boolean := false;
BEGIN
  IF NOT portal.is_admin() THEN RAISE EXCEPTION 'Apenas admin pode gerir operadores.' USING ERRCODE = '42501'; END IF;
  DELETE FROM portal.demand_operators WHERE demand_id = p_demand_id AND operator_id = p_operator_id;
  v_removed := FOUND;
  IF v_removed THEN PERFORM portal._resync_demand_assignees(p_demand_id); END IF;
  RETURN jsonb_build_object('ok', true, 'removed', v_removed);
END;
$function$;

GRANT EXECUTE ON FUNCTION portal.admin_add_demand_operator(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION portal.admin_remove_demand_operator(uuid, uuid) TO authenticated;
