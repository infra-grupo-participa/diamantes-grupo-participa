-- ============================================================================
-- 003_portal_insights_tables.sql
-- Cria tabelas de insights do portal: services, ratings, task_reviews,
-- client_profiles. Segue o padrão de RLS já estabelecido em 002.
--
-- Aplicação: Supabase Dashboard → SQL Editor → cole tudo → Run.
-- Pré-requisito: 002_fix_rls_critical.sql já aplicado (portal.is_admin() existe).
-- ============================================================================

-- ─── Schema ───────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS portal;

-- ─── portal.clients (base — cria se não existir) ──────────────────────────────
CREATE TABLE IF NOT EXISTS portal.clients (
  id               bigserial PRIMARY KEY,
  slug             text        NOT NULL UNIQUE,
  display_name     text        NOT NULL DEFAULT '',
  cliente_task_id  text        NOT NULL DEFAULT '',
  cu_list_id       text        NOT NULL DEFAULT '',
  cf_tipos         jsonb       NOT NULL DEFAULT '[]',
  assignee_ids     jsonb       NOT NULL DEFAULT '{}',
  auto_map         jsonb       NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── portal.users (base — cria se não existir) ────────────────────────────────
CREATE TABLE IF NOT EXISTS portal.users (
  id              bigserial PRIMARY KEY,
  auth_user_id    uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL DEFAULT '' CHECK (name !~ '[<>]'),
  email           text        NOT NULL DEFAULT '',
  role            text        NOT NULL DEFAULT 'client' CHECK (role IN ('admin','client')),
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','disabled')),
  client_slug     text        REFERENCES portal.clients(slug) ON DELETE SET NULL,
  document_type   text        CHECK (document_type IN ('CPF','CNPJ',NULL)),
  document_value  text        DEFAULT '',
  billing_status  text        NOT NULL DEFAULT 'current' CHECK (billing_status IN ('current','late','canceled')),
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── portal.services (contratos cliente ↔ prestador) ─────────────────────────
CREATE TABLE IF NOT EXISTS portal.services (
  id           bigserial PRIMARY KEY,
  client_slug  text        NOT NULL REFERENCES portal.clients(slug) ON DELETE CASCADE,
  client_name  text        NOT NULL DEFAULT '',
  service      text        NOT NULL,
  employee     text        NOT NULL,
  status       text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled')),
  started_at   date,
  ended_at     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_slug, service, employee)
);

-- ─── portal.ratings (avaliações 1-10 por tarefa) ──────────────────────────────
CREATE TABLE IF NOT EXISTS portal.ratings (
  id           bigserial PRIMARY KEY,
  task_id      text        NOT NULL,
  task_name    text        NOT NULL DEFAULT '',
  client_slug  text        NOT NULL REFERENCES portal.clients(slug) ON DELETE CASCADE,
  client_name  text        NOT NULL DEFAULT '',
  service      text        NOT NULL DEFAULT '',
  employee     text        NOT NULL DEFAULT '',
  score        smallint    NOT NULL CHECK (score >= 1 AND score <= 10),
  label        text        NOT NULL DEFAULT '',
  resolved_at  text        DEFAULT NULL,
  revision_key text        NOT NULL DEFAULT '',
  url          text        NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, revision_key)
);

-- ─── portal.task_reviews (aprovação / pedido de ajuste) ───────────────────────
CREATE TABLE IF NOT EXISTS portal.task_reviews (
  id           bigserial PRIMARY KEY,
  task_id      text        NOT NULL,
  task_name    text        NOT NULL DEFAULT '',
  client_slug  text        NOT NULL REFERENCES portal.clients(slug) ON DELETE CASCADE,
  client_name  text        NOT NULL DEFAULT '',
  service      text        NOT NULL DEFAULT '',
  employee     text        NOT NULL DEFAULT '',
  status       text        NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','changes_requested')),
  notes        text        NOT NULL DEFAULT '',
  resolved_at  text        DEFAULT NULL,
  revision_key text        NOT NULL DEFAULT '',
  url          text        NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, revision_key)
);

-- ─── portal.client_profiles (formulário mensal do cliente) ────────────────────
CREATE TABLE IF NOT EXISTS portal.client_profiles (
  id                  bigserial PRIMARY KEY,
  client_slug         text        NOT NULL UNIQUE REFERENCES portal.clients(slug) ON DELETE CASCADE,
  client_name         text        NOT NULL DEFAULT '',
  seminar             jsonb       NOT NULL DEFAULT '{}',
  billing_status      text        NOT NULL DEFAULT 'current' CHECK (billing_status IN ('current','late','canceled')),
  contract_started_at date        DEFAULT NULL,
  contract_ended_at   date        DEFAULT NULL,
  canceled_date       date        DEFAULT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── portal.audit_log ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal.audit_log (
  id           bigserial PRIMARY KEY,
  actor_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email  text        DEFAULT '',
  action       text        NOT NULL,
  target_type  text        DEFAULT '',
  target_id    text        DEFAULT '',
  payload      jsonb       DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── portal.rate_limits ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal.rate_limits (
  id           bigserial PRIMARY KEY,
  key          text        NOT NULL UNIQUE,
  hits         int         NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);

-- ─── RLS: habilitar em todas as novas tabelas ─────────────────────────────────
ALTER TABLE portal.clients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.services        ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.ratings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.task_reviews    ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.client_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.rate_limits     ENABLE ROW LEVEL SECURITY;

-- ─── portal.services — policies ───────────────────────────────────────────────
DROP POLICY IF EXISTS "services_admin_all"      ON portal.services;
DROP POLICY IF EXISTS "services_select_own"     ON portal.services;

CREATE POLICY "services_admin_all"
ON portal.services FOR ALL TO authenticated
USING (portal.is_admin()) WITH CHECK (portal.is_admin());

CREATE POLICY "services_select_own"
ON portal.services FOR SELECT TO authenticated
USING (
  client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
);

-- ─── portal.ratings — policies ────────────────────────────────────────────────
DROP POLICY IF EXISTS "ratings_admin_all"       ON portal.ratings;
DROP POLICY IF EXISTS "ratings_insert_own"      ON portal.ratings;
DROP POLICY IF EXISTS "ratings_select_own"      ON portal.ratings;

CREATE POLICY "ratings_admin_all"
ON portal.ratings FOR ALL TO authenticated
USING (portal.is_admin()) WITH CHECK (portal.is_admin());

CREATE POLICY "ratings_select_own"
ON portal.ratings FOR SELECT TO authenticated
USING (
  client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
);

CREATE POLICY "ratings_insert_own"
ON portal.ratings FOR INSERT TO authenticated
WITH CHECK (
  client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
);

-- ─── portal.task_reviews — policies ───────────────────────────────────────────
DROP POLICY IF EXISTS "task_reviews_admin_all"  ON portal.task_reviews;
DROP POLICY IF EXISTS "task_reviews_insert_own" ON portal.task_reviews;
DROP POLICY IF EXISTS "task_reviews_select_own" ON portal.task_reviews;

CREATE POLICY "task_reviews_admin_all"
ON portal.task_reviews FOR ALL TO authenticated
USING (portal.is_admin()) WITH CHECK (portal.is_admin());

CREATE POLICY "task_reviews_select_own"
ON portal.task_reviews FOR SELECT TO authenticated
USING (
  client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
);

CREATE POLICY "task_reviews_insert_own"
ON portal.task_reviews FOR INSERT TO authenticated
WITH CHECK (
  client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
);

-- ─── portal.client_profiles — policies ────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_admin_all"      ON portal.client_profiles;
DROP POLICY IF EXISTS "profiles_upsert_own"     ON portal.client_profiles;
DROP POLICY IF EXISTS "profiles_select_own"     ON portal.client_profiles;

CREATE POLICY "profiles_admin_all"
ON portal.client_profiles FOR ALL TO authenticated
USING (portal.is_admin()) WITH CHECK (portal.is_admin());

CREATE POLICY "profiles_select_own"
ON portal.client_profiles FOR SELECT TO authenticated
USING (
  client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
);

CREATE POLICY "profiles_upsert_own"
ON portal.client_profiles FOR INSERT TO authenticated
WITH CHECK (
  client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
);

CREATE POLICY "profiles_update_own"
ON portal.client_profiles FOR UPDATE TO authenticated
USING (
  client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
) WITH CHECK (
  client_slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
);

-- ─── portal.audit_log — policies ──────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_log_admin_select"  ON portal.audit_log;
DROP POLICY IF EXISTS "audit_log_insert_auth"   ON portal.audit_log;

CREATE POLICY "audit_log_admin_select"
ON portal.audit_log FOR SELECT TO authenticated
USING (portal.is_admin());

CREATE POLICY "audit_log_insert_auth"
ON portal.audit_log FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid());

-- ─── portal.rate_limits — service_role only (sem policy para authenticated) ───

-- ─── Expor schemas via PostgREST ──────────────────────────────────────────────
-- Rode no Supabase Dashboard → Settings → API → Extra Search Path:
--   portal, public
-- Ou via postgres.conf: set search_path = portal, public, "$user"

-- ─── Verificação final ────────────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'portal' ORDER BY table_name;
-- SELECT polname, tablename FROM pg_policies WHERE schemaname = 'portal' ORDER BY tablename, polname;
