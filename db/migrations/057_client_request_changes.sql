-- 057_client_request_changes
-- Fluxo de revisão: quando a demanda está "Em revisão", além de "Aprovar e concluir"
-- (client_complete_demand), o cliente pode PEDIR AJUSTES — a demanda volta para
-- "Em andamento" e o chat reabre para ele explicar o que falta. A nota em si é
-- postada como mensagem normal pelo front (reusa o sync de chat → ClickUp).
CREATE OR REPLACE FUNCTION portal.client_request_changes(p_demand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public'
AS $function$
DECLARE
  v_caller portal.users%ROWTYPE;
  v_demand portal.demands%ROWTYPE;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida. Entre novamente.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_demand FROM portal.demands WHERE id = p_demand_id LIMIT 1;
  IF v_demand.id IS NULL THEN
    RAISE EXCEPTION 'Demanda não encontrada.';
  END IF;
  IF v_demand.client_slug IS DISTINCT FROM v_caller.client_slug AND NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Você não tem acesso a esta demanda.' USING ERRCODE = '42501';
  END IF;
  IF v_demand.status IS DISTINCT FROM 'review' THEN
    RAISE EXCEPTION 'Só é possível pedir ajustes quando a demanda está em revisão.';
  END IF;

  UPDATE portal.demands
     SET status = 'in_progress', updated_at = now()
   WHERE id = p_demand_id
   RETURNING * INTO v_demand;

  RETURN jsonb_build_object('status', v_demand.status);
END;
$function$;

GRANT EXECUTE ON FUNCTION portal.client_request_changes(uuid) TO authenticated;
