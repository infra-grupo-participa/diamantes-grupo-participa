-- 032_fix_audit_log_columns.sql
-- FIX: as funções de 031/029 inseriam em portal.audit_log com colunas inexistentes
-- (event_type/entity_type/entity_id) e actor_id = portal.users.id (bigint) em coluna uuid.
-- Schema real: audit_log(actor_id uuid, actor_email text, action text, target_type text,
-- target_id text, payload jsonb). Isso quebrava submit_base_briefing, submit_project_briefing
-- e create_project ("column event_type ... does not exist").
-- CREATE OR REPLACE — seguro reaplicar; preserva grants.

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

CREATE OR REPLACE FUNCTION portal.create_project(
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

  IF NOT portal.client_base_ready(v_caller.client_slug) THEN
    RAISE EXCEPTION 'Complete o Briefing Básico antes de criar um projeto.';
  END IF;

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

CREATE OR REPLACE FUNCTION portal.submit_project_briefing(
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
