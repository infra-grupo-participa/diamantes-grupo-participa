-- 031_briefing_base_projeto.sql
-- Briefing em 2 níveis (Básico do cliente = acessos/gate + Projeto = evento multi-serviço)
-- e chamados em dois modos. Substitui o modelo "1 projeto = 1 serviço" da migration 029.
--
-- IMPORTANTE: idempotente onde possível (IF EXISTS / IF NOT EXISTS). Aplicar no Supabase SQL editor.

-- ════════════════════════════════════════════════════════════════
-- 1. Tabela portal.client_briefing  (Briefing Básico = acessos, 1/cliente, gate)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS portal.client_briefing (
  client_slug    text        PRIMARY KEY REFERENCES portal.clients(slug) ON DELETE CASCADE,
  access         jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { anuncios_pagos:{...}, paginas:{...}, ... }
  base_status    text        NOT NULL DEFAULT 'draft',
  pending_flags  jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- ["anuncios_pagos.gtm", ...] (campos "não tenho")
  submitted_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_briefing_status_check CHECK (base_status IN ('draft','submitted'))
);

ALTER TABLE portal.client_briefing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_briefing_select ON portal.client_briefing;
CREATE POLICY client_briefing_select ON portal.client_briefing
  FOR SELECT TO authenticated
  USING (
    client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1)
    OR portal.is_admin()
    OR EXISTS (
      SELECT 1 FROM portal.team_assignments ta
      JOIN portal.operators op ON op.id = ta.operator_id
      JOIN portal.users u ON u.email = op.email
      WHERE ta.client_slug = portal.client_briefing.client_slug
        AND u.auth_user_id = auth.uid()
    )
  );

-- INSERT/UPDATE acontecem via RPCs SECURITY DEFINER; aqui liberamos o dono e admin como rede de segurança.
DROP POLICY IF EXISTS client_briefing_insert ON portal.client_briefing;
CREATE POLICY client_briefing_insert ON portal.client_briefing
  FOR INSERT TO authenticated
  WITH CHECK (
    client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1)
    OR portal.is_admin()
  );

DROP POLICY IF EXISTS client_briefing_update ON portal.client_briefing;
CREATE POLICY client_briefing_update ON portal.client_briefing
  FOR UPDATE TO authenticated
  USING (
    client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1)
    OR portal.is_admin()
  );

-- ════════════════════════════════════════════════════════════════
-- 2. Reestrutura portal.projects → EVENTO multi-serviço
-- ════════════════════════════════════════════════════════════════
ALTER TABLE portal.projects ADD COLUMN IF NOT EXISTS services text[] NOT NULL DEFAULT '{}';

-- service_type (single, de 029) vira LEGADO
ALTER TABLE portal.projects ALTER COLUMN service_type DROP NOT NULL;
ALTER TABLE portal.projects DROP CONSTRAINT IF EXISTS projects_service_type_check;

-- Transform best-effort dos projetos existentes (shape antigo → {general, services})
-- Mapeia web_design_automacao → paginas + automacao.
UPDATE portal.projects p
SET
  services = CASE
    WHEN p.service_type = 'web_design_automacao' THEN ARRAY['paginas','automacao']
    WHEN p.service_type IS NOT NULL              THEN ARRAY[p.service_type]
    ELSE '{}'
  END,
  briefing = jsonb_build_object(
    'general', COALESCE(p.briefing->'general', '{}'::jsonb),
    'services', CASE
      WHEN p.briefing ? 'services' THEN p.briefing->'services'
      WHEN p.service_type = 'web_design_automacao'
        THEN jsonb_build_object('paginas', COALESCE(p.briefing,'{}'::jsonb), 'automacao', '{}'::jsonb)
      WHEN p.service_type IS NOT NULL
        THEN jsonb_build_object(p.service_type, COALESCE(p.briefing,'{}'::jsonb))
      ELSE '{}'::jsonb
    END
  )
WHERE NOT (p.briefing ? 'general' AND p.briefing ? 'services')   -- só linhas ainda no shape antigo
  AND p.services = '{}';

-- ════════════════════════════════════════════════════════════════
-- 3. Helper: serviços de briefing contratados pelo cliente
--    Mapeia portal.services.service_type (normalizado/variável) → chave de briefing.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION portal.client_briefing_services(p_slug text)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path = portal, public
AS $$
  SELECT COALESCE(array_agg(DISTINCT bk), '{}')
  FROM (
    SELECT CASE
      WHEN upper(s.service_type) LIKE '%TRAFEGO%' OR upper(s.service_type) LIKE '%TRÁFEGO%'
        OR upper(s.service_type) LIKE '%ANUNCIO%' OR upper(s.service_type) LIKE '%ANÚNCIO%' THEN 'anuncios_pagos'
      WHEN upper(s.service_type) LIKE '%EDICAO%' OR upper(s.service_type) LIKE '%EDIÇÃO%'
        OR upper(s.service_type) LIKE '%VIDEO%' OR upper(s.service_type) LIKE '%VÍDEO%' THEN 'edicao_video'
      WHEN upper(s.service_type) LIKE '%WEB%' OR upper(s.service_type) LIKE '%PAGINA%'
        OR upper(s.service_type) LIKE '%PÁGINA%' OR upper(s.service_type) LIKE '%HOSPED%' THEN 'paginas'
      WHEN upper(s.service_type) LIKE '%AUTOMA%' OR upper(s.service_type) LIKE '%DISPARO%' THEN 'automacao'
      ELSE NULL
    END AS bk
    FROM portal.services s
    WHERE s.client_slug = p_slug
      AND COALESCE(lower(s.status), 'active') NOT IN ('cancelled','canceled','inactive','removed')
  ) m
  WHERE bk IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION portal.client_briefing_services(text) TO authenticated;

-- Helper de gate
CREATE OR REPLACE FUNCTION portal.client_base_ready(p_slug text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = portal, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM portal.client_briefing
    WHERE client_slug = p_slug AND base_status = 'submitted'
  );
$$;

GRANT EXECUTE ON FUNCTION portal.client_base_ready(text) TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. RPCs do Briefing Básico
-- ════════════════════════════════════════════════════════════════

-- 4.1) get_client_briefing — garante a linha do chamador e a retorna (+ serviços contratados)
CREATE OR REPLACE FUNCTION portal.get_client_briefing()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = portal, public
AS $$
DECLARE
  v_caller portal.users;
  v_row    portal.client_briefing;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
  IF v_caller.client_slug IS NULL THEN RAISE EXCEPTION 'Usuário sem cliente associado.'; END IF;

  INSERT INTO portal.client_briefing (client_slug)
  VALUES (v_caller.client_slug)
  ON CONFLICT (client_slug) DO NOTHING;

  SELECT * INTO v_row FROM portal.client_briefing WHERE client_slug = v_caller.client_slug;

  RETURN jsonb_build_object(
    'client_slug',   v_row.client_slug,
    'access',        v_row.access,
    'base_status',   v_row.base_status,
    'pending_flags', v_row.pending_flags,
    'submitted_at',  v_row.submitted_at,
    'services',      to_jsonb(portal.client_briefing_services(v_caller.client_slug))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION portal.get_client_briefing() TO authenticated;

-- 4.2) save_base_briefing — merge dos acessos (rascunho)
CREATE OR REPLACE FUNCTION portal.save_base_briefing(
  p_access  jsonb,
  p_pending jsonb DEFAULT NULL
)
RETURNS portal.client_briefing
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = portal, public
AS $$
DECLARE
  v_caller portal.users;
  v_row    portal.client_briefing;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
  IF v_caller.client_slug IS NULL THEN RAISE EXCEPTION 'Usuário sem cliente associado.'; END IF;

  INSERT INTO portal.client_briefing (client_slug, access, pending_flags)
  VALUES (v_caller.client_slug, COALESCE(p_access,'{}'::jsonb), COALESCE(p_pending,'[]'::jsonb))
  ON CONFLICT (client_slug) DO UPDATE
    SET access        = portal.client_briefing.access || COALESCE(EXCLUDED.access,'{}'::jsonb),
        pending_flags = COALESCE(p_pending, portal.client_briefing.pending_flags),
        updated_at    = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.save_base_briefing(jsonb, jsonb) TO authenticated;

-- 4.3) submit_base_briefing — fecha o gate
CREATE OR REPLACE FUNCTION portal.submit_base_briefing()
RETURNS portal.client_briefing
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = portal, public
AS $$
DECLARE
  v_caller portal.users;
  v_row    portal.client_briefing;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;

  SELECT * INTO v_row FROM portal.client_briefing WHERE client_slug = v_caller.client_slug;
  IF v_row.client_slug IS NULL OR v_row.access = '{}'::jsonb THEN
    RAISE EXCEPTION 'Preencha os acessos antes de enviar.';
  END IF;

  UPDATE portal.client_briefing
  SET base_status = 'submitted', submitted_at = now(), updated_at = now()
  WHERE client_slug = v_caller.client_slug
  RETURNING * INTO v_row;

  INSERT INTO portal.audit_log (actor_id, actor_email, action, target_type, target_id, payload)
  VALUES (v_caller.auth_user_id, v_caller.email, 'base_submitted', 'client_briefing', v_caller.client_slug,
          jsonb_build_object('client_slug', v_caller.client_slug));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.submit_base_briefing() TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. RPCs do Projeto (substituem as de 029)
-- ════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS portal.create_project(text, text);
DROP FUNCTION IF EXISTS portal.save_briefing_draft(uuid, jsonb);
DROP FUNCTION IF EXISTS portal.submit_briefing(uuid);

-- 5.1) create_project — exige gate; cria evento multi-serviço
CREATE FUNCTION portal.create_project(
  p_title    text,
  p_general  jsonb   DEFAULT '{}'::jsonb,
  p_services text[]  DEFAULT '{}'
)
RETURNS portal.projects
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = portal, public
AS $$
DECLARE
  v_caller     portal.users;
  v_project    portal.projects;
  v_contracted text[];
  v_svc        text;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
  IF v_caller.role NOT IN ('user','client') THEN RAISE EXCEPTION 'Apenas clientes podem criar projetos.'; END IF;
  IF v_caller.status != 'approved' THEN RAISE EXCEPTION 'Conta não aprovada.'; END IF;

  -- GATE: Briefing Básico enviado
  IF NOT portal.client_base_ready(v_caller.client_slug) THEN
    RAISE EXCEPTION 'Complete o Briefing Básico antes de criar um projeto.';
  END IF;

  -- Valida services ⊆ contratados
  v_contracted := portal.client_briefing_services(v_caller.client_slug);
  FOREACH v_svc IN ARRAY COALESCE(p_services,'{}') LOOP
    IF NOT (v_svc = ANY (v_contracted)) THEN
      RAISE EXCEPTION 'Serviço % não contratado por este cliente.', v_svc;
    END IF;
  END LOOP;

  INSERT INTO portal.projects (client_slug, created_by, title, services, briefing, status)
  VALUES (
    v_caller.client_slug, v_caller.id, trim(p_title),
    COALESCE(p_services,'{}'),
    jsonb_build_object('general', COALESCE(p_general,'{}'::jsonb), 'services', '{}'::jsonb),
    'briefing'
  )
  RETURNING * INTO v_project;

  INSERT INTO portal.audit_log (actor_id, actor_email, action, target_type, target_id, payload)
  VALUES (v_caller.auth_user_id, v_caller.email, 'project_created', 'project', v_project.id::text,
          jsonb_build_object('title', p_title, 'services', to_jsonb(p_services)));

  RETURN v_project;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.create_project(text, jsonb, text[]) TO authenticated;

-- 5.2) save_project_briefing — merge profundo (general + services)
CREATE FUNCTION portal.save_project_briefing(
  p_project_id uuid,
  p_answers    jsonb
)
RETURNS portal.projects
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = portal, public
AS $$
DECLARE
  v_caller   portal.users;
  v_project  portal.projects;
  v_general  jsonb;
  v_services jsonb;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;

  SELECT * INTO v_project FROM portal.projects WHERE id = p_project_id;
  IF v_project.id IS NULL THEN RAISE EXCEPTION 'Projeto não encontrado.'; END IF;
  IF v_project.client_slug != v_caller.client_slug AND NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;
  IF v_project.briefing_status = 'submitted' AND NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Briefing já enviado — não pode ser editado.';
  END IF;

  v_general := COALESCE(v_project.briefing->'general','{}'::jsonb) || COALESCE(p_answers->'general','{}'::jsonb);

  v_services := COALESCE(v_project.briefing->'services','{}'::jsonb);
  v_services := v_services || COALESCE((
    SELECT jsonb_object_agg(k, COALESCE(v_services->k,'{}'::jsonb) || v)
    FROM jsonb_each(COALESCE(p_answers->'services','{}'::jsonb)) AS e(k, v)
  ), '{}'::jsonb);

  UPDATE portal.projects
  SET briefing = jsonb_build_object('general', v_general, 'services', v_services),
      updated_at = now()
  WHERE id = p_project_id
  RETURNING * INTO v_project;

  RETURN v_project;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.save_project_briefing(uuid, jsonb) TO authenticated;

-- 5.3) submit_project_briefing — ativa o evento
CREATE FUNCTION portal.submit_project_briefing(
  p_project_id uuid
)
RETURNS portal.projects
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = portal, public
AS $$
DECLARE
  v_caller  portal.users;
  v_project portal.projects;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;

  SELECT * INTO v_project FROM portal.projects WHERE id = p_project_id;
  IF v_project.id IS NULL THEN RAISE EXCEPTION 'Projeto não encontrado.'; END IF;
  IF v_project.client_slug != v_caller.client_slug AND NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;
  IF v_project.briefing_status = 'submitted' THEN RAISE EXCEPTION 'Briefing já foi enviado.'; END IF;
  IF COALESCE(v_project.briefing->'general','{}'::jsonb) = '{}'::jsonb THEN
    RAISE EXCEPTION 'Preencha os dados do evento antes de enviar.';
  END IF;

  UPDATE portal.projects
  SET briefing_status = 'submitted', briefing_submitted_at = now(),
      status = 'active', updated_at = now()
  WHERE id = p_project_id
  RETURNING * INTO v_project;

  INSERT INTO portal.audit_log (actor_id, actor_email, action, target_type, target_id, payload)
  VALUES (v_caller.auth_user_id, v_caller.email, 'project_briefing_submitted', 'project', v_project.id::text,
          jsonb_build_object('title', v_project.title, 'services', to_jsonb(v_project.services)));

  RETURN v_project;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.submit_project_briefing(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 6. create_demand canônico + gate (reconcilia assinaturas históricas)
-- ════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS portal.create_demand(text, text, uuid[], timestamptz, timestamptz);
DROP FUNCTION IF EXISTS portal.create_demand(text, text, uuid[], uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS portal.create_demand(text, text, uuid[], text, timestamptz, timestamptz);

CREATE FUNCTION portal.create_demand(
  p_title       text,
  p_description text,
  p_operators   uuid[],
  p_project_id  uuid        DEFAULT NULL,
  p_starts_at   timestamptz DEFAULT NULL,
  p_ends_at     timestamptz DEFAULT NULL
)
RETURNS portal.demands
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = portal, public
AS $$
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

  -- GATE: cliente precisa do Briefing Básico (admin é isento)
  IF v_caller.role != 'admin' AND NOT portal.client_base_ready(v_caller.client_slug) THEN
    RAISE EXCEPTION 'Complete o Briefing Básico antes de abrir um chamado.';
  END IF;

  -- Valida projeto (modo "chamado por projeto")
  IF p_project_id IS NOT NULL THEN
    SELECT * INTO v_project FROM portal.projects WHERE id = p_project_id LIMIT 1;
    IF v_project.id IS NULL THEN RAISE EXCEPTION 'Projeto não encontrado.'; END IF;
    IF v_project.client_slug != v_caller.client_slug AND NOT portal.is_admin() THEN
      RAISE EXCEPTION 'Projeto não pertence a este cliente.';
    END IF;
    IF v_project.status NOT IN ('active','briefing') THEN RAISE EXCEPTION 'Projeto não está ativo.'; END IF;
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
$$;

GRANT EXECUTE ON FUNCTION portal.create_demand(text, text, uuid[], uuid, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION portal.create_demand(text, text, uuid[], uuid, timestamptz, timestamptz) IS
  'Assinatura canônica (031): cria chamado simples (p_project_id NULL) ou por projeto. Gate do Briefing Básico para clientes.';
