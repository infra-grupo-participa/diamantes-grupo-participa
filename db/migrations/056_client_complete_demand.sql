-- 056_client_complete_demand
-- Remonta a finalização da demanda pelo CLIENTE.
--
-- Problema: a UI mostrava "Finalizar minha parte" ao cliente, chamando
-- finalize_my_part — RPC que exige um membro role='operator' em demand_members.
-- Mas demand_members só tem role='client' (operadores vivem em demand_operators e
-- não têm login). Resultado: o cliente SEMPRE recebia "Você não é operador desta
-- demanda" (exibido como "[object Object]" no front).
--
-- Novo modelo de produto: a equipe entrega e marca "Em revisão" (status='review',
-- via ClickUp/admin). Só então o cliente aprova e conclui → status='done', o que
-- dispara trg_demand_done_request_ratings (placeholder de avaliação 5★) e o
-- _sync_demand_to_clickup (fecha a tarefa no ClickUp). A equipe segue podendo
-- concluir direto pelo ClickUp.
CREATE OR REPLACE FUNCTION portal.client_complete_demand(p_demand_id uuid)
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

  IF v_demand.status = 'done' THEN
    RAISE EXCEPTION 'Esta demanda já está concluída.';
  END IF;
  IF v_demand.status = 'canceled' THEN
    RAISE EXCEPTION 'Esta demanda foi cancelada.';
  END IF;
  IF v_demand.status IS DISTINCT FROM 'review' THEN
    RAISE EXCEPTION 'A demanda só pode ser concluída quando a equipe enviá-la para sua aprovação (Em revisão).';
  END IF;

  UPDATE portal.demands
     SET status = 'done', finalized_at = now(), updated_at = now()
   WHERE id = p_demand_id
   RETURNING * INTO v_demand;

  RETURN jsonb_build_object(
    'status', v_demand.status,
    'finalized_at', v_demand.finalized_at
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION portal.client_complete_demand(uuid) TO authenticated;
