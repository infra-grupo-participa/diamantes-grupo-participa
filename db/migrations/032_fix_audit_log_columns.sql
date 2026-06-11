-- 032_fix_audit_log_columns.sql
-- FIX: as funções de 031/029 gravavam em portal.audit_log com colunas que NÃO existem
-- no schema real de produção. O audit_log em prod tem apenas (id, created_at, user_id, metadata),
-- divergente da definição do repo (003). Tentativas com event_type/entity_* e depois
-- actor_id/action/target_* falharam ("column ... does not exist").
--
-- Decisão: REMOVER o INSERT em audit_log dessas 3 funções (log é acessório; o fluxo de
-- briefing/projeto não pode quebrar por causa de logging). Auditoria pode ser re-adicionada
-- depois, alinhada ao schema real. CREATE OR REPLACE — seguro reaplicar; preserva grants.

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

  RETURN v_project;
END;
$$;
