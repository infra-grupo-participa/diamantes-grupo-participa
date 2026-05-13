-- Migration 018: reescreve create_demand para usar portal.operators
-- Corrige bug pós-migration 016: a RPC validava operadores via portal.users
-- WHERE role='operator' AND status='approved', mas após 016 todos os operadores
-- têm status='disabled' em portal.users. Agora valida via portal.operators.

CREATE OR REPLACE FUNCTION portal.create_demand(
  p_title         text,
  p_description   text,
  p_operator_ids  uuid[],
  p_starts_at     timestamptz DEFAULT NULL,
  p_ends_at       timestamptz DEFAULT NULL
)
RETURNS portal.demands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portal, public
AS $$
DECLARE
  v_caller    portal.users;
  v_demand    portal.demands;
  v_op        uuid;
  v_allowed   boolean;
BEGIN
  -- Identifica o chamador pela sessão Supabase Auth
  SELECT * INTO v_caller
  FROM portal.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  IF v_caller.role NOT IN ('client', 'admin') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF v_caller.status != 'approved' AND v_caller.role != 'admin' THEN
    RAISE EXCEPTION 'Conta não aprovada.';
  END IF;

  -- Valida cada operador: deve estar em team_assignments do slug do cliente
  -- e ativo em portal.operators
  FOREACH v_op IN ARRAY p_operator_ids LOOP
    IF v_caller.role = 'admin' THEN
      -- Admin pode atribuir qualquer operador ativo
      SELECT EXISTS (
        SELECT 1 FROM portal.operators o
        WHERE o.id = v_op
          AND o.status = 'active'
          AND o.contract_active = true
      ) INTO v_allowed;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM portal.team_assignments ta
        JOIN portal.operators o ON o.id = ta.operator_id
        WHERE ta.client_slug = v_caller.client_slug
          AND ta.operator_id = v_op
          AND o.status = 'active'
          AND o.contract_active = true
      ) INTO v_allowed;
    END IF;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'Operador % não autorizado para este cliente.', v_op;
    END IF;
  END LOOP;

  -- Cria a demanda
  INSERT INTO portal.demands (
    client_slug,
    created_by,
    title,
    description,
    starts_at,
    ends_at,
    status
  ) VALUES (
    COALESCE(v_caller.client_slug, ''),
    v_caller.id,
    trim(p_title),
    trim(COALESCE(p_description, '')),
    p_starts_at,
    p_ends_at,
    'open'
  )
  RETURNING * INTO v_demand;

  -- Insere o criador em demand_members (RLS/chat)
  INSERT INTO portal.demand_members (demand_id, user_id, role)
  VALUES (v_demand.id, v_caller.id, 'client')
  ON CONFLICT (demand_id, user_id) DO NOTHING;

  -- Insere operadores em demand_operators (nova tabela pós-016)
  FOREACH v_op IN ARRAY p_operator_ids LOOP
    INSERT INTO portal.demand_operators (demand_id, operator_id)
    SELECT v_demand.id, o.id
    FROM portal.operators o
    WHERE o.id = v_op
      AND o.status = 'active'
    ON CONFLICT (demand_id, operator_id) DO NOTHING;
  END LOOP;

  RETURN v_demand;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.create_demand(text, text, uuid[], timestamptz, timestamptz)
  TO authenticated;
