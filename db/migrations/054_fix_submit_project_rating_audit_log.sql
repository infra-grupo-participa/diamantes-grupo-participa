-- 054_fix_submit_project_rating_audit_log
-- BUG: submit_project_rating inseria em portal.audit_log com colunas inexistentes
-- (event_type/actor_id/entity_type/entity_id/payload) → TODA avaliação de PROJETO
-- falhava com "column event_type of relation audit_log does not exist". Corrige para
-- as colunas reais (event, user_id, identifier, metadata).
-- Aplicada via MCP em npqyvjhvtfahuxfmuhie.
CREATE OR REPLACE FUNCTION portal.submit_project_rating(
  p_project_id uuid, p_stars smallint, p_comment text DEFAULT NULL::text, p_nps smallint DEFAULT NULL::smallint)
RETURNS portal.project_ratings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal','public'
AS $function$
DECLARE v_caller portal.users; v_slug text; v_rating portal.project_ratings;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
  SELECT client_slug INTO v_slug FROM portal.projects WHERE id = p_project_id;
  IF v_slug IS NULL THEN RAISE EXCEPTION 'Projeto não encontrado.'; END IF;
  IF v_slug <> v_caller.client_slug AND NOT portal.is_admin() THEN RAISE EXCEPTION 'Permissão negada.'; END IF;
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN RAISE EXCEPTION 'Nota deve estar entre 1 e 5 estrelas.'; END IF;
  IF p_nps IS NOT NULL AND (p_nps < 0 OR p_nps > 10) THEN RAISE EXCEPTION 'NPS deve estar entre 0 e 10.'; END IF;
  PERFORM portal.request_project_rating(p_project_id);
  UPDATE portal.project_ratings
     SET stars=p_stars, comment=NULLIF(trim(COALESCE(p_comment,'')),''), nps=p_nps, status='submitted', submitted_at=now()
   WHERE project_id = p_project_id RETURNING * INTO v_rating;
  INSERT INTO portal.audit_log (event, user_id, identifier, metadata)
  VALUES ('project_rating_submitted', v_caller.id, p_project_id::text,
          jsonb_build_object('entity_type','project','stars', p_stars, 'nps', p_nps));
  RETURN v_rating;
END; $function$;
