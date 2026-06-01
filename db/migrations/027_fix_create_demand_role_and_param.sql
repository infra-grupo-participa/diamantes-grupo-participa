-- Migration 027: corrige dois bugs em portal.create_demand
--
-- Bug 1: parâmetro 'p_operator_ids' não bate com o nome que portal-api.js envia ('p_operators').
--        PostgREST mapeia por nome → a chamada falhava silenciosamente.
--
-- Bug 2: role check 'NOT IN (client, admin)' bloqueava clientes com role='user'
--        (role foi renomeado de 'client' → 'user' numa migração anterior mas a RPC não foi atualizada).

-- Drop explícito pois mudamos o nome de um parâmetro (mesmo tipo, novo nome = nova assinatura no catálogo)
DROP FUNCTION IF EXISTS portal.create_demand(text, text, uuid[], timestamptz, timestamptz);

CREATE FUNCTION portal.create_demand(
  p_title         text,
  p_description   text,
  p_operators     uuid[],
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
  SELECT * INTO v_caller
  FROM portal.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  -- 'user' é o role de clientes; 'client' era o nome legado
  IF v_caller.role NOT IN ('user', 'client', 'admin') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF v_caller.status != 'approved' AND v_caller.role != 'admin' THEN
    RAISE EXCEPTION 'Conta não aprovada.';
  END IF;

  FOREACH v_op IN ARRAY p_operators LOOP
    IF v_caller.role = 'admin' THEN
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

  INSERT INTO portal.demands (
    client_slug, created_by, title, description, starts_at, ends_at, status
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

  INSERT INTO portal.demand_members (demand_id, user_id, role)
  VALUES (v_demand.id, v_caller.id, 'client')
  ON CONFLICT (demand_id, user_id) DO NOTHING;

  FOREACH v_op IN ARRAY p_operators LOOP
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

COMMENT ON FUNCTION portal.create_demand IS
  'Cria demanda para cliente (role=user/client) ou admin. Vincula operadores em demand_operators para rastreamento de avaliações.';
