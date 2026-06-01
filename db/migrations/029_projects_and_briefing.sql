-- 029_projects_and_briefing.sql
-- Projetos com Briefing de Abertura estruturado por tipo de serviço.

-- ─────────────────────────────────────────────
-- 1. Tabela portal.projects
-- ─────────────────────────────────────────────
CREATE TABLE portal.projects (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_slug            text        NOT NULL REFERENCES portal.clients(slug) ON DELETE CASCADE,
  created_by             uuid        NOT NULL REFERENCES portal.users(id),
  title                  text        NOT NULL,
  service_type           text        NOT NULL,
  status                 text        NOT NULL DEFAULT 'briefing',
  briefing               jsonb       NOT NULL DEFAULT '{}',
  briefing_status        text        NOT NULL DEFAULT 'draft',
  briefing_submitted_at  timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT projects_service_type_check CHECK (service_type IN (
    'anuncios_pagos', 'design_grafico', 'edicao_video',
    'social_media', 'web_design_automacao'
  )),
  CONSTRAINT projects_status_check CHECK (status IN (
    'briefing', 'active', 'completed', 'cancelled'
  )),
  CONSTRAINT projects_briefing_status_check CHECK (briefing_status IN (
    'draft', 'submitted'
  ))
);

CREATE INDEX idx_projects_client_slug ON portal.projects(client_slug);
CREATE INDEX idx_projects_status      ON portal.projects(status);
CREATE INDEX idx_projects_service     ON portal.projects(service_type);

-- ─────────────────────────────────────────────
-- 2. FK em portal.demands
-- ─────────────────────────────────────────────
ALTER TABLE portal.demands
  ADD COLUMN project_id uuid REFERENCES portal.projects(id) ON DELETE SET NULL;

CREATE INDEX idx_demands_project_id ON portal.demands(project_id);

-- ─────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────
ALTER TABLE portal.projects ENABLE ROW LEVEL SECURITY;

-- Cliente vê só os seus projetos
CREATE POLICY projects_select ON portal.projects
  FOR SELECT TO authenticated
  USING (
    client_slug = (
      SELECT client_slug FROM portal.users
      WHERE auth_user_id = auth.uid() LIMIT 1
    )
    OR portal.is_admin()
    OR EXISTS (
      SELECT 1 FROM portal.team_assignments ta
      JOIN portal.operators op ON op.id = ta.operator_id
      JOIN portal.users u ON u.email = op.email
      WHERE ta.client_slug = portal.projects.client_slug
        AND u.auth_user_id = auth.uid()
    )
  );

-- Cliente cria projetos só para o seu client_slug
CREATE POLICY projects_insert ON portal.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    client_slug = (
      SELECT client_slug FROM portal.users
      WHERE auth_user_id = auth.uid() LIMIT 1
    )
    OR portal.is_admin()
  );

-- Cliente edita só enquanto briefing_status = 'draft'; admin sempre
CREATE POLICY projects_update ON portal.projects
  FOR UPDATE TO authenticated
  USING (
    (
      client_slug = (
        SELECT client_slug FROM portal.users
        WHERE auth_user_id = auth.uid() LIMIT 1
      )
      AND briefing_status = 'draft'
    )
    OR portal.is_admin()
  );

-- ─────────────────────────────────────────────
-- 4. RPC: create_project
-- ─────────────────────────────────────────────
CREATE FUNCTION portal.create_project(
  p_title        text,
  p_service_type text
)
RETURNS portal.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portal, public
AS $$
DECLARE
  v_caller  portal.users;
  v_project portal.projects;
BEGIN
  SELECT * INTO v_caller
  FROM portal.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  IF v_caller.role NOT IN ('user', 'client') THEN
    RAISE EXCEPTION 'Apenas clientes podem criar projetos.';
  END IF;

  IF v_caller.status != 'approved' THEN
    RAISE EXCEPTION 'Conta não aprovada.';
  END IF;

  IF p_service_type NOT IN (
    'anuncios_pagos', 'design_grafico', 'edicao_video',
    'social_media', 'web_design_automacao'
  ) THEN
    RAISE EXCEPTION 'Tipo de serviço inválido: %.', p_service_type;
  END IF;

  INSERT INTO portal.projects (client_slug, created_by, title, service_type)
  VALUES (v_caller.client_slug, v_caller.id, trim(p_title), p_service_type)
  RETURNING * INTO v_project;

  INSERT INTO portal.audit_log (event_type, actor_id, entity_type, entity_id, payload)
  VALUES ('project_created', v_caller.id, 'project', v_project.id,
          jsonb_build_object('title', p_title, 'service_type', p_service_type));

  RETURN v_project;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.create_project(text, text) TO authenticated;

-- ─────────────────────────────────────────────
-- 5. RPC: save_briefing_draft
-- ─────────────────────────────────────────────
CREATE FUNCTION portal.save_briefing_draft(
  p_project_id uuid,
  p_answers    jsonb
)
RETURNS portal.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portal, public
AS $$
DECLARE
  v_caller  portal.users;
  v_project portal.projects;
BEGIN
  SELECT * INTO v_caller
  FROM portal.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  SELECT * INTO v_project
  FROM portal.projects
  WHERE id = p_project_id
  LIMIT 1;

  IF v_project.id IS NULL THEN
    RAISE EXCEPTION 'Projeto não encontrado.';
  END IF;

  IF v_project.client_slug != v_caller.client_slug AND NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF v_project.briefing_status = 'submitted' AND NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Briefing já enviado — não pode ser editado.';
  END IF;

  UPDATE portal.projects
  SET briefing   = briefing || p_answers,
      updated_at = now()
  WHERE id = p_project_id
  RETURNING * INTO v_project;

  RETURN v_project;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.save_briefing_draft(uuid, jsonb) TO authenticated;

-- ─────────────────────────────────────────────
-- 6. RPC: submit_briefing
-- ─────────────────────────────────────────────
CREATE FUNCTION portal.submit_briefing(
  p_project_id uuid
)
RETURNS portal.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portal, public
AS $$
DECLARE
  v_caller  portal.users;
  v_project portal.projects;
BEGIN
  SELECT * INTO v_caller
  FROM portal.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  SELECT * INTO v_project
  FROM portal.projects
  WHERE id = p_project_id
  LIMIT 1;

  IF v_project.id IS NULL THEN
    RAISE EXCEPTION 'Projeto não encontrado.';
  END IF;

  IF v_project.client_slug != v_caller.client_slug AND NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF v_project.briefing_status = 'submitted' THEN
    RAISE EXCEPTION 'Briefing já foi enviado.';
  END IF;

  -- Validação mínima: briefing não pode estar vazio
  IF v_project.briefing = '{}' OR v_project.briefing IS NULL THEN
    RAISE EXCEPTION 'Preencha o briefing antes de enviar.';
  END IF;

  UPDATE portal.projects
  SET briefing_status       = 'submitted',
      briefing_submitted_at = now(),
      status                = 'active',
      updated_at            = now()
  WHERE id = p_project_id
  RETURNING * INTO v_project;

  INSERT INTO portal.audit_log (event_type, actor_id, entity_type, entity_id, payload)
  VALUES ('briefing_submitted', v_caller.id, 'project', v_project.id,
          jsonb_build_object('service_type', v_project.service_type, 'title', v_project.title));

  RETURN v_project;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.submit_briefing(uuid) TO authenticated;

-- ─────────────────────────────────────────────
-- 7. Atualiza create_demand para aceitar project_id
-- ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS portal.create_demand(text, text, uuid[], timestamptz, timestamptz);

CREATE FUNCTION portal.create_demand(
  p_title       text,
  p_description text,
  p_operators   uuid[],
  p_project_id  uuid        DEFAULT NULL,
  p_starts_at   timestamptz DEFAULT NULL,
  p_ends_at     timestamptz DEFAULT NULL
)
RETURNS portal.demands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = portal, public
AS $$
DECLARE
  v_caller  portal.users;
  v_demand  portal.demands;
  v_op      uuid;
  v_allowed boolean;
  v_project portal.projects;
BEGIN
  SELECT * INTO v_caller
  FROM portal.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  IF v_caller.role NOT IN ('user', 'client', 'admin') THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF v_caller.status != 'approved' AND v_caller.role != 'admin' THEN
    RAISE EXCEPTION 'Conta não aprovada.';
  END IF;

  -- Valida projeto se fornecido
  IF p_project_id IS NOT NULL THEN
    SELECT * INTO v_project
    FROM portal.projects
    WHERE id = p_project_id LIMIT 1;

    IF v_project.id IS NULL THEN
      RAISE EXCEPTION 'Projeto não encontrado.';
    END IF;

    IF v_project.client_slug != v_caller.client_slug AND NOT portal.is_admin() THEN
      RAISE EXCEPTION 'Projeto não pertence a este cliente.';
    END IF;

    IF v_project.status NOT IN ('active', 'briefing') THEN
      RAISE EXCEPTION 'Projeto não está ativo.';
    END IF;
  END IF;

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
          AND o.status = 'active'
          AND o.contract_active = true
      ) INTO v_allowed;
    END IF;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'Operador % não autorizado para este cliente.', v_op;
    END IF;
  END LOOP;

  INSERT INTO portal.demands (
    client_slug, created_by, title, description,
    project_id, starts_at, ends_at, status
  ) VALUES (
    COALESCE(v_caller.client_slug, ''),
    v_caller.id,
    trim(p_title),
    trim(COALESCE(p_description, '')),
    p_project_id,
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
    WHERE o.id = v_op AND o.status = 'active'
    ON CONFLICT (demand_id, operator_id) DO NOTHING;
  END LOOP;

  RETURN v_demand;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.create_demand(text, text, uuid[], uuid, timestamptz, timestamptz)
  TO authenticated;

COMMENT ON FUNCTION portal.create_demand IS
  'Cria demanda para cliente (role=user/client) ou admin. Aceita project_id opcional para vincular ao briefing de projeto.';
