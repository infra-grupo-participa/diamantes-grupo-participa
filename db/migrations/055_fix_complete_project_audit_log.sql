-- 055_fix_complete_project_audit_log
-- BUG: complete_project inseria em portal.audit_log com colunas inexistentes
-- (event_type/actor_id/entity_type/entity_id/payload) → o botão "Concluir" do admin
-- (ProjetosClient) falhava SEMPRE com "column event_type of relation audit_log does not
-- exist", e por tabela o trigger de avaliação de projeto (que depende de status='completed')
-- nunca era disparado pela via real. Mesmo bug já corrigido na 054 para submit_project_rating.
-- Colunas reais do audit_log: event, user_id, identifier, ip, metadata.
-- Aplicada via MCP em npqyvjhvtfahuxfmuhie.
CREATE OR REPLACE FUNCTION portal.complete_project(p_project_id uuid)
 RETURNS portal.projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public'
AS $function$
DECLARE v_caller portal.users; v_project portal.projects;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
  IF NOT portal.is_admin() THEN RAISE EXCEPTION 'Apenas admin pode concluir projetos.'; END IF;
  SELECT * INTO v_project FROM portal.projects WHERE id = p_project_id LIMIT 1;
  IF v_project.id IS NULL THEN RAISE EXCEPTION 'Projeto não encontrado.'; END IF;
  IF v_project.status = 'completed' THEN RAISE EXCEPTION 'Projeto já está concluído.'; END IF;
  UPDATE portal.projects SET status='completed', completed_at=now(), updated_at=now()
   WHERE id = p_project_id RETURNING * INTO v_project;
  INSERT INTO portal.audit_log (event, user_id, identifier, metadata)
  VALUES ('project_completed', v_caller.id, v_project.id::text,
          jsonb_build_object('entity_type','project','title', v_project.title));
  RETURN v_project;
END; $function$;
