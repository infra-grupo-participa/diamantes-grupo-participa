-- ============================================================================
-- 036_project_ratings.sql
-- ----------------------------------------------------------------------------
-- Avaliação do cliente AO FINAL DO PROJETO (CSAT 5 estrelas + comentário + NPS).
--
-- Padrão de mercado: ao encerrar o projeto (status 'completed'), pede-se uma
-- avaliação consolidada. Aqui:
--   - portal.projects ganha completed_at.
--   - nova tabela portal.project_ratings (1 avaliação por projeto), escala
--     1-5 estrelas, comentário opcional e NPS (0-10) opcional.
--   - complete_project(): admin encerra o projeto.
--   - trigger ao status→'completed' cria o placeholder 'pending' (garante que
--     toda conclusão gere um convite de avaliação).
--   - submit_project_rating(): cliente envia a nota.
--   - get_my_pending_project_ratings(): alimenta o banner insistente no portal.
--
-- A expiração dos pendentes é tratada na migration 038 (cron).
-- Dependências: 029 (projects), is_admin(), audit_log, users.auth_user_id.
-- ============================================================================

-- ─────────────────────────────────────────────
-- 1) Coluna completed_at em projects
-- ─────────────────────────────────────────────
ALTER TABLE portal.projects
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- ─────────────────────────────────────────────
-- 2) Tabela portal.project_ratings
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal.project_ratings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES portal.projects(id) ON DELETE CASCADE,
  client_slug   text NOT NULL REFERENCES portal.clients(slug) ON DELETE CASCADE,
  stars         smallint,                       -- 1..5, NULL enquanto pending
  comment       text,
  nps           smallint,                       -- 0..10 "recomendaria?", opcional
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'submitted', 'expired')),
  submitted_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id),
  CONSTRAINT project_ratings_stars_range CHECK (stars IS NULL OR (stars BETWEEN 1 AND 5)),
  CONSTRAINT project_ratings_nps_range   CHECK (nps   IS NULL OR (nps   BETWEEN 0 AND 10)),
  -- submitted exige nota
  CONSTRAINT project_ratings_submitted_has_stars CHECK (status <> 'submitted' OR stars IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_project_ratings_client ON portal.project_ratings(client_slug);
CREATE INDEX IF NOT EXISTS idx_project_ratings_status ON portal.project_ratings(status);

-- ─────────────────────────────────────────────
-- 3) RLS
-- ─────────────────────────────────────────────
ALTER TABLE portal.project_ratings ENABLE ROW LEVEL SECURITY;

-- Cliente vê as avaliações dos seus projetos; admin tudo.
DROP POLICY IF EXISTS project_ratings_select ON portal.project_ratings;
CREATE POLICY project_ratings_select ON portal.project_ratings
  FOR SELECT TO authenticated
  USING (
    client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1)
    OR portal.is_admin()
  );

-- Escrita só via RPC (SECURITY DEFINER). Sem INSERT/UPDATE direto p/ authenticated.

-- ─────────────────────────────────────────────
-- 4) request_project_rating — cria placeholder pending (idempotente)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION portal.request_project_rating(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
  v_slug    text;
  v_rating_id uuid;
  v_created bool := false;
BEGIN
  SELECT client_slug INTO v_slug FROM portal.projects WHERE id = p_project_id;
  IF v_slug IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'projeto não encontrado');
  END IF;

  INSERT INTO portal.project_ratings (project_id, client_slug, status)
  VALUES (p_project_id, v_slug, 'pending')
  ON CONFLICT (project_id) DO NOTHING
  RETURNING id INTO v_rating_id;

  IF v_rating_id IS NOT NULL THEN
    v_created := true;
  ELSE
    SELECT id INTO v_rating_id FROM portal.project_ratings WHERE project_id = p_project_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'created', v_created, 'rating_id', v_rating_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION portal.request_project_rating(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION portal.request_project_rating(uuid) TO authenticated;

-- ─────────────────────────────────────────────
-- 5) complete_project — admin encerra projeto (dispara avaliação via trigger)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION portal.complete_project(p_project_id uuid)
RETURNS portal.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal', 'public'
AS $$
DECLARE
  v_caller  portal.users;
  v_project portal.projects;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;
  IF NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Apenas admin pode concluir projetos.';
  END IF;

  SELECT * INTO v_project FROM portal.projects WHERE id = p_project_id LIMIT 1;
  IF v_project.id IS NULL THEN
    RAISE EXCEPTION 'Projeto não encontrado.';
  END IF;
  IF v_project.status = 'completed' THEN
    RAISE EXCEPTION 'Projeto já está concluído.';
  END IF;

  UPDATE portal.projects
     SET status       = 'completed',
         completed_at = now(),
         updated_at   = now()
   WHERE id = p_project_id
   RETURNING * INTO v_project;
  -- trigger trg_project_completed_request_rating cria o placeholder de avaliação

  INSERT INTO portal.audit_log (event_type, actor_id, entity_type, entity_id, payload)
  VALUES ('project_completed', v_caller.id, 'project', v_project.id,
          jsonb_build_object('title', v_project.title, 'service_type', v_project.service_type));

  RETURN v_project;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.complete_project(uuid) TO authenticated;

-- ─────────────────────────────────────────────
-- 6) Trigger: ao projeto virar 'completed', solicita avaliação
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION portal._trg_project_completed_request_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
BEGIN
  IF NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  END IF;
  PERFORM portal.request_project_rating(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_completed_request_rating ON portal.projects;
CREATE TRIGGER trg_project_completed_request_rating
  AFTER UPDATE OF status ON portal.projects
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION portal._trg_project_completed_request_rating();

COMMENT ON FUNCTION portal._trg_project_completed_request_rating IS
  'Ao projeto virar completed, cria placeholder pending em project_ratings (convite de avaliação).';

-- ─────────────────────────────────────────────
-- 7) submit_project_rating — cliente envia a avaliação (5★ + comentário + NPS)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION portal.submit_project_rating(
  p_project_id uuid,
  p_stars      smallint,
  p_comment    text DEFAULT NULL,
  p_nps        smallint DEFAULT NULL
)
RETURNS portal.project_ratings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal', 'public'
AS $$
DECLARE
  v_caller  portal.users;
  v_slug    text;
  v_rating  portal.project_ratings;
BEGIN
  SELECT * INTO v_caller FROM portal.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.';
  END IF;

  SELECT client_slug INTO v_slug FROM portal.projects WHERE id = p_project_id;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'Projeto não encontrado.';
  END IF;
  IF v_slug <> v_caller.client_slug AND NOT portal.is_admin() THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
    RAISE EXCEPTION 'Nota deve estar entre 1 e 5 estrelas.';
  END IF;
  IF p_nps IS NOT NULL AND (p_nps < 0 OR p_nps > 10) THEN
    RAISE EXCEPTION 'NPS deve estar entre 0 e 10.';
  END IF;

  -- garante placeholder e então submete
  PERFORM portal.request_project_rating(p_project_id);

  UPDATE portal.project_ratings
     SET stars        = p_stars,
         comment      = NULLIF(trim(COALESCE(p_comment, '')), ''),
         nps          = p_nps,
         status       = 'submitted',
         submitted_at = now()
   WHERE project_id = p_project_id
   RETURNING * INTO v_rating;

  INSERT INTO portal.audit_log (event_type, actor_id, entity_type, entity_id, payload)
  VALUES ('project_rating_submitted', v_caller.id, 'project', p_project_id,
          jsonb_build_object('stars', p_stars, 'nps', p_nps));

  RETURN v_rating;
END;
$$;

GRANT EXECUTE ON FUNCTION portal.submit_project_rating(uuid, smallint, text, smallint) TO authenticated;

-- ─────────────────────────────────────────────
-- 8) get_my_pending_project_ratings — projetos concluídos aguardando avaliação
--    (alimenta o banner insistente no portal do cliente)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION portal.get_my_pending_project_ratings()
RETURNS TABLE (
  project_id   uuid,
  title        text,
  completed_at timestamptz,
  rating_id    uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
  SELECT p.id, p.title, p.completed_at, pr.id
  FROM portal.projects p
  JOIN portal.project_ratings pr ON pr.project_id = p.id
  JOIN portal.users u ON u.auth_user_id = auth.uid()
  WHERE p.client_slug = u.client_slug
    AND pr.status = 'pending'
  ORDER BY p.completed_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION portal.get_my_pending_project_ratings() TO authenticated;

-- ─────────────────────────────────────────────
-- 9) Backfill: projetos JÁ 'completed' sem completed_at/avaliação
--    Garante que conclusões anteriores também recebam convite de avaliação.
-- ─────────────────────────────────────────────
UPDATE portal.projects
   SET completed_at = COALESCE(completed_at, updated_at, created_at)
 WHERE status = 'completed' AND completed_at IS NULL;

INSERT INTO portal.project_ratings (project_id, client_slug, status)
SELECT p.id, p.client_slug, 'pending'
FROM portal.projects p
WHERE p.status = 'completed'
  AND NOT EXISTS (SELECT 1 FROM portal.project_ratings pr WHERE pr.project_id = p.id)
ON CONFLICT (project_id) DO NOTHING;

-- ─────────────────────────────────────────────
-- 10) View de leitura para admin (satisfação por projeto)
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW portal.v_project_ratings
WITH (security_invoker = on) AS
SELECT
  pr.project_id,
  p.client_slug,
  c.display_name AS client_name,
  p.title,
  p.completed_at,
  pr.stars,
  pr.nps,
  pr.comment,
  pr.status,
  pr.submitted_at
FROM portal.project_ratings pr
JOIN portal.projects p ON p.id = pr.project_id
JOIN portal.clients  c ON c.slug = p.client_slug;

GRANT SELECT ON portal.v_project_ratings TO authenticated;

-- ============================================================================
-- Fim 036_project_ratings.sql
-- ============================================================================
