-- 051_create_demand_autofill_team
-- create_demand: se nenhum operador for enviado, associa AUTOMATICAMENTE a equipe
-- pré-definida do cliente (team_assignments ativos) — garante que as notificações
-- do ClickUp cheguem ao time. O modal já pré-seleciona toda a equipe; isto é a rede
-- de segurança no backend. Aplicada via MCP em npqyvjhvtfahuxfmuhie.
CREATE OR REPLACE FUNCTION portal.create_demand(
  p_title text, p_description text, p_operators uuid[],
  p_project_id uuid DEFAULT NULL::uuid,
  p_starts_at timestamptz DEFAULT NULL::timestamptz,
  p_ends_at timestamptz DEFAULT NULL::timestamptz)
RETURNS portal.demands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal','public'
AS $function$
DECLARE
  v_caller  portal.users;
  v_demand  portal.demands;
  v_op      uuid;
  v_allowed boolean;
  v_project portal.projects;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
  IF v_caller.role NOT IN ('user','client','admin') THEN RAISE EXCEPTION 'Permissão negada.'; END IF;
  IF v_caller.status != 'approved' AND v_caller.role != 'admin' THEN RAISE EXCEPTION 'Conta não aprovada.'; END IF;

  IF v_caller.role != 'admin' AND NOT portal.client_base_ready(v_caller.client_slug) THEN
    RAISE EXCEPTION 'Complete o Briefing Básico antes de abrir um chamado.';
  END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT * INTO v_project FROM portal.projects WHERE id = p_project_id LIMIT 1;
    IF v_project.id IS NULL THEN RAISE EXCEPTION 'Projeto não encontrado.'; END IF;
    IF v_project.client_slug != v_caller.client_slug AND NOT portal.is_admin() THEN
      RAISE EXCEPTION 'Projeto não pertence a este cliente.';
    END IF;
    IF v_project.status NOT IN ('active','briefing') THEN RAISE EXCEPTION 'Projeto não está ativo.'; END IF;
  END IF;

  -- Rede de segurança: sem operadores enviados → usa a equipe pré-definida do cliente.
  IF (p_operators IS NULL OR array_length(p_operators,1) IS NULL)
     AND v_caller.role <> 'admin' AND v_caller.client_slug IS NOT NULL THEN
    SELECT array_agg(ta.operator_id)
      INTO p_operators
      FROM portal.team_assignments ta
      JOIN portal.operators o ON o.id = ta.operator_id
     WHERE ta.client_slug = v_caller.client_slug
       AND o.status = 'active' AND o.contract_active = true;
  END IF;
  p_operators := COALESCE(p_operators, '{}'::uuid[]);

  FOREACH v_op IN ARRAY p_operators LOOP
    IF v_caller.role = 'admin' THEN
      SELECT EXISTS (
        SELECT 1 FROM portal.operators o
        WHERE o.id = v_op AND o.status = 'active' AND o.contract_active = true
      ) INTO v_allowed;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM portal.team_assignments ta
        JOIN portal.operators o ON o.id = ta.operator_id
        WHERE ta.client_slug = v_caller.client_slug
          AND ta.operator_id = v_op
          AND o.status = 'active' AND o.contract_active = true
      ) INTO v_allowed;
    END IF;
    IF NOT v_allowed THEN RAISE EXCEPTION 'Operador % não autorizado para este cliente.', v_op; END IF;
  END LOOP;

  INSERT INTO portal.demands (client_slug, created_by, title, description, project_id, starts_at, ends_at, status)
  VALUES (COALESCE(v_caller.client_slug,''), v_caller.id, trim(p_title),
          trim(COALESCE(p_description,'')), p_project_id, p_starts_at, p_ends_at, 'open')
  RETURNING * INTO v_demand;

  INSERT INTO portal.demand_members (demand_id, user_id, role)
  VALUES (v_demand.id, v_caller.id, 'client')
  ON CONFLICT (demand_id, user_id) DO NOTHING;

  FOREACH v_op IN ARRAY p_operators LOOP
    INSERT INTO portal.demand_operators (demand_id, operator_id)
    SELECT v_demand.id, o.id FROM portal.operators o
    WHERE o.id = v_op AND o.status = 'active'
    ON CONFLICT (demand_id, operator_id) DO NOTHING;
  END LOOP;

  RETURN v_demand;
END;
$function$;
