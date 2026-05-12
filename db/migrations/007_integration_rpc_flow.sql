-- ============================================================================
-- 007_integration_rpc_flow.sql
-- RPCs de fluxo do ciclo de avaliação.
-- ----------------------------------------------------------------------------
-- Dependências:
--   - 006 (tabelas operator_to_client_ratings, ratings.demand_id+status,
--     operator_points, users.points_score)
--
-- RPCs criadas:
--   - request_client_rating(demand_id):    placeholder em ratings (pending)
--   - request_operator_ratings(demand_id): placeholders em operator_to_client_ratings (pending)
--   - submit_client_rating(demand_id, score, comment): cliente envia avaliação
--   - submit_operator_rating(demand_id, score, comment, dimensions): operador envia
--   - create_demand atualizada: valida operators contra team_assignments
--
-- Triggers/cron de auto-close (7d) ficam na FC.
-- ============================================================================

-- ============================================================================
-- 1) request_client_rating(p_demand_id uuid)
-- ----------------------------------------------------------------------------
-- Cria placeholder em portal.ratings com status='pending'. Será chamada pelo
-- trigger ao fechar a demanda (FC), mas exposta também para chamadas manuais
-- (RPC) caso necessário.
-- - Idempotente: ON CONFLICT (mesmo demand_id + client_slug) NÃO inserir.
-- - Score=0 no placeholder (será sobrescrito pelo submit). Score=0 viola
--   CHECK existente (1..10), então usamos score=1 como sentinela (será
--   sobrescrito ao submeter).
--
-- SECURITY DEFINER porque pode ser chamada pelo trigger AFTER UPDATE de
-- demands (que roda no contexto do operador que finalizou) mas precisa
-- escrever em ratings (que normalmente exige ser admin/cliente).
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.request_client_rating(p_demand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
  v_demand        portal.demands%ROWTYPE;
  v_existing_id   uuid;
  v_rating_id     uuid;
BEGIN
  SELECT * INTO v_demand FROM portal.demands WHERE id = p_demand_id;
  IF v_demand.id IS NULL THEN
    RAISE EXCEPTION 'Demanda não encontrada.' USING ERRCODE = '22023';
  END IF;

  -- Idempotência: se já existe rating (de qualquer status) pra essa demanda+cliente, não cria de novo
  SELECT id INTO v_existing_id FROM portal.ratings
  WHERE demand_id = p_demand_id AND client_slug = v_demand.client_slug
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', false, 'rating_id', v_existing_id);
  END IF;

  INSERT INTO portal.ratings (
    demand_id, client_slug, task_id, score, status, submitted_at
  ) VALUES (
    p_demand_id,
    v_demand.client_slug,
    v_demand.clickup_task_id,  -- pode ser NULL pra demandas locais
    1,                          -- placeholder; será sobrescrito ao submit
    'pending',
    NULL
  )
  RETURNING id INTO v_rating_id;

  RETURN jsonb_build_object('ok', true, 'created', true, 'rating_id', v_rating_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION portal.request_client_rating(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION portal.request_client_rating(uuid) TO authenticated;

COMMENT ON FUNCTION portal.request_client_rating IS 'Cria placeholder de rating (status=pending) ao fechar demanda. Idempotente.';

-- ============================================================================
-- 2) request_operator_ratings(p_demand_id uuid)
-- ----------------------------------------------------------------------------
-- Cria placeholders em operator_to_client_ratings (status=pending) para CADA
-- operador da demanda. Operadores avaliam o cliente.
-- - Idempotente via UNIQUE(demand_id, operator_id) + ON CONFLICT DO NOTHING.
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.request_operator_ratings(p_demand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
  v_demand   portal.demands%ROWTYPE;
  v_created  int := 0;
BEGIN
  SELECT * INTO v_demand FROM portal.demands WHERE id = p_demand_id;
  IF v_demand.id IS NULL THEN
    RAISE EXCEPTION 'Demanda não encontrada.' USING ERRCODE = '22023';
  END IF;

  WITH ins AS (
    INSERT INTO portal.operator_to_client_ratings (
      demand_id, operator_id, client_slug, score, status, submitted_at
    )
    SELECT
      p_demand_id, dm.user_id, v_demand.client_slug, 1, 'pending', NULL
    FROM portal.demand_members dm
    WHERE dm.demand_id = p_demand_id AND dm.role = 'operator'
    ON CONFLICT (demand_id, operator_id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_created FROM ins;

  RETURN jsonb_build_object('ok', true, 'created', v_created);
END;
$$;

REVOKE EXECUTE ON FUNCTION portal.request_operator_ratings(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION portal.request_operator_ratings(uuid) TO authenticated;

COMMENT ON FUNCTION portal.request_operator_ratings IS 'Cria placeholders de avaliação reversa (operator→client) para todos os operadores da demanda.';

-- ============================================================================
-- 3) submit_client_rating(p_demand_id, p_score, p_comment)
-- ----------------------------------------------------------------------------
-- Cliente envia avaliação (1..10). Atualiza placeholder pending → submitted.
-- Se não houver placeholder (demanda fechada antes da migration 007), cria.
-- Trigger AFTER UPDATE em ratings (FC) vai pontuar operadores (escala A).
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.submit_client_rating(
  p_demand_id uuid,
  p_score     smallint,
  p_comment   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
  v_caller    portal.users%ROWTYPE;
  v_demand    portal.demands%ROWTYPE;
  v_rating_id uuid;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid();
  IF v_caller.id IS NULL OR v_caller.status <> 'approved' THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_demand FROM portal.demands WHERE id = p_demand_id;
  IF v_demand.id IS NULL THEN
    RAISE EXCEPTION 'Demanda não encontrada.' USING ERRCODE = '22023';
  END IF;

  -- Apenas cliente da demanda (ou admin) pode avaliar
  IF NOT portal.is_admin() AND v_caller.client_slug IS DISTINCT FROM v_demand.client_slug THEN
    RAISE EXCEPTION 'Você não pode avaliar essa demanda.' USING ERRCODE = '42501';
  END IF;

  IF p_score IS NULL OR p_score < 1 OR p_score > 10 THEN
    RAISE EXCEPTION 'Score precisa estar entre 1 e 10.' USING ERRCODE = '22023';
  END IF;

  -- Garante que existe um placeholder. Se não houver, cria.
  PERFORM portal.request_client_rating(p_demand_id);

  UPDATE portal.ratings
     SET score        = p_score,
         comment      = COALESCE(p_comment, comment),
         user_id      = v_caller.id,
         status       = 'submitted',
         submitted_at = now()
   WHERE demand_id = p_demand_id
     AND client_slug = v_demand.client_slug
     AND status IN ('pending', 'submitted')
   RETURNING id INTO v_rating_id;

  RETURN jsonb_build_object('ok', true, 'rating_id', v_rating_id, 'score', p_score);
END;
$$;

REVOKE EXECUTE ON FUNCTION portal.submit_client_rating(uuid, smallint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION portal.submit_client_rating(uuid, smallint, text) TO authenticated;

COMMENT ON FUNCTION portal.submit_client_rating IS 'Cliente envia avaliação 1..10 + comentário. Atualiza placeholder pending → submitted. Trigger da FC pontua operadores.';

-- ============================================================================
-- 4) submit_operator_rating(p_demand_id, p_score, p_comment, p_dimensions)
-- ----------------------------------------------------------------------------
-- Operador envia avaliação do cliente (1..5). Atualiza placeholder.
-- Apenas operadores da demanda podem submeter (RLS já garante via UPDATE).
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.submit_operator_rating(
  p_demand_id  uuid,
  p_score      smallint,
  p_comment    text  DEFAULT NULL,
  p_dimensions jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
  v_caller   portal.users%ROWTYPE;
  v_demand   portal.demands%ROWTYPE;
  v_is_op    boolean;
  v_rat_id   uuid;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid();
  IF v_caller.id IS NULL OR v_caller.status <> 'approved' THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_demand FROM portal.demands WHERE id = p_demand_id;
  IF v_demand.id IS NULL THEN
    RAISE EXCEPTION 'Demanda não encontrada.' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM portal.demand_members
    WHERE demand_id = p_demand_id AND user_id = v_caller.id AND role = 'operator'
  ) INTO v_is_op;

  IF NOT v_is_op AND NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Você não é operador desta demanda.' USING ERRCODE = '42501';
  END IF;

  IF p_score IS NULL OR p_score < 1 OR p_score > 5 THEN
    RAISE EXCEPTION 'Score precisa estar entre 1 e 5.' USING ERRCODE = '22023';
  END IF;

  -- Garante placeholder. Idempotente.
  PERFORM portal.request_operator_ratings(p_demand_id);

  UPDATE portal.operator_to_client_ratings
     SET score        = p_score,
         comment      = COALESCE(p_comment, comment),
         dimensions   = COALESCE(p_dimensions, dimensions),
         status       = 'submitted',
         submitted_at = now()
   WHERE demand_id   = p_demand_id
     AND operator_id = v_caller.id
   RETURNING id INTO v_rat_id;

  IF v_rat_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível registrar a avaliação.' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('ok', true, 'rating_id', v_rat_id, 'score', p_score);
END;
$$;

REVOKE EXECUTE ON FUNCTION portal.submit_operator_rating(uuid, smallint, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION portal.submit_operator_rating(uuid, smallint, text, jsonb) TO authenticated;

COMMENT ON FUNCTION portal.submit_operator_rating IS 'Operador envia avaliação 1..5 + dimensions JSON. Atualiza placeholder → submitted.';

-- ============================================================================
-- 5) create_demand atualizada — valida operators contra team_assignments
-- ----------------------------------------------------------------------------
-- Hoje aceita qualquer operador aprovado. Passa a exigir que o operador
-- esteja alocado ao cliente em portal.team_assignments. Admin pode escolher
-- qualquer um (override).
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.create_demand(
  p_title       text,
  p_description text,
  p_operators   uuid[],
  p_starts_at   date DEFAULT NULL,
  p_ends_at     date DEFAULT NULL
)
RETURNS portal.demands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal', 'public'
AS $$
DECLARE
  v_caller    portal.users%ROWTYPE;
  v_demand    portal.demands%ROWTYPE;
  v_op        uuid;
  v_allowed   boolean;
  v_is_admin  boolean;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid();
  IF v_caller.id IS NULL OR v_caller.status <> 'approved' THEN
    RAISE EXCEPTION 'Apenas clientes aprovados podem abrir demandas.' USING ERRCODE = '42501';
  END IF;

  v_is_admin := portal.is_admin();

  IF NOT v_is_admin AND (v_caller.role <> 'user' OR v_caller.client_slug IS NULL) THEN
    RAISE EXCEPTION 'Apenas clientes aprovados podem abrir demandas.' USING ERRCODE = '42501';
  END IF;

  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'Título obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF p_operators IS NULL OR array_length(p_operators, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione pelo menos um operador.' USING ERRCODE = '22023';
  END IF;

  -- Validação: cada operador precisa estar em team_assignments do cliente
  -- (ignorada para admin, que pode escolher qualquer operador aprovado)
  IF NOT v_is_admin THEN
    FOREACH v_op IN ARRAY p_operators LOOP
      SELECT EXISTS (
        SELECT 1
        FROM portal.team_assignments ta
        JOIN portal.users u ON u.id = ta.user_id
        WHERE ta.client_slug = v_caller.client_slug
          AND ta.user_id     = v_op
          AND u.role         = 'operator'
          AND u.status       = 'approved'
      ) INTO v_allowed;

      IF NOT v_allowed THEN
        RAISE EXCEPTION 'Operador % não pertence à sua equipe.', v_op USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  INSERT INTO portal.demands (client_slug, title, description, starts_at, ends_at, created_by, status)
  VALUES (v_caller.client_slug, trim(p_title), p_description, p_starts_at, p_ends_at, v_caller.id, 'open')
  RETURNING * INTO v_demand;

  -- Cliente solicitante como membro do chat
  INSERT INTO portal.demand_members (demand_id, user_id, role)
  VALUES (v_demand.id, v_caller.id, 'client');

  -- Operadores escolhidos
  FOREACH v_op IN ARRAY p_operators LOOP
    INSERT INTO portal.demand_members (demand_id, user_id, role)
    SELECT v_demand.id, u.id, 'operator'
    FROM portal.users u
    WHERE u.id = v_op AND u.role = 'operator' AND u.status = 'approved'
    ON CONFLICT (demand_id, user_id) DO NOTHING;
  END LOOP;

  RETURN v_demand;
END;
$$;

REVOKE EXECUTE ON FUNCTION portal.create_demand(text, text, uuid[], date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION portal.create_demand(text, text, uuid[], date, date) TO authenticated;

COMMENT ON FUNCTION portal.create_demand IS 'Cliente abre demanda. Valida operators contra team_assignments do cliente. Admin pode override.';

-- ============================================================================
-- Fim 007_integration_rpc_flow.sql
-- ============================================================================
