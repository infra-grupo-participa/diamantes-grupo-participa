-- ============================================================================
-- 002_fix_rls_critical.sql
-- Fix vulnerabilidades CRÍTICAS encontradas no pentest 2026-05-09:
--   1. Privilege escalation via UPDATE em portal.users (user vira admin)
--   2. IDOR write — cliente modifica QUALQUER user
--   3. IDOR read em portal.clients — qualquer cliente lê todos os 28 clientes
--   4. ClickUp BOLA fix será no PHP
--   5. Stored XSS via name field — fix client-side + DB-level mitigation
--
-- Aplicação: Supabase Dashboard → SQL Editor → cole tudo → Run.
-- ============================================================================

-- ─── Helper: identifica admin via portal.users ────────────────────────────────
CREATE OR REPLACE FUNCTION portal.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = portal, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM portal.users
    WHERE auth_user_id = auth.uid()
      AND role = 'admin'
      AND status = 'approved'
  );
$$;

-- ─── portal.users — derruba TODAS policies legacy, recria seguras ─────────────
-- IMPORTANTE: PostgreSQL avalia policies com OR — UMA permissiva existente
-- pode neutralizar todas as restritivas. Limpa tudo antes.

DROP POLICY IF EXISTS "users_admin_all"               ON portal.users;
DROP POLICY IF EXISTS "users_admin_update_all"        ON portal.users;
DROP POLICY IF EXISTS "users_self_update_basic"       ON portal.users;
DROP POLICY IF EXISTS "users_read_own_or_admin"       ON portal.users;
DROP POLICY IF EXISTS "users_update_own"              ON portal.users;
DROP POLICY IF EXISTS "users_update_self"             ON portal.users;
DROP POLICY IF EXISTS "users_update"                  ON portal.users;
DROP POLICY IF EXISTS "Allow update for users"        ON portal.users;
DROP POLICY IF EXISTS "Enable update for users based on auth_user_id" ON portal.users;

-- 1. Admin pode atualizar tudo
CREATE POLICY "users_admin_update_all"
ON portal.users FOR UPDATE
TO authenticated
USING (portal.is_admin())
WITH CHECK (portal.is_admin());

-- 2. User comum pode atualizar APENAS sua própria linha,
--    e APENAS campos não-privilegiados (name, document, metadata).
--    Bloqueia auto-promoção: role / status / client_slug / auth_user_id.
CREATE POLICY "users_update_own_safe"
ON portal.users FOR UPDATE
TO authenticated
USING (auth_user_id = auth.uid() AND NOT portal.is_admin())
WITH CHECK (
  auth_user_id = auth.uid()
  AND role          = (SELECT role          FROM portal.users WHERE auth_user_id = auth.uid())
  AND status        = (SELECT status        FROM portal.users WHERE auth_user_id = auth.uid())
  AND client_slug IS NOT DISTINCT FROM (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
);

-- ─── portal.users — DELETE só admin ───────────────────────────────────────────
DROP POLICY IF EXISTS "users_delete"                  ON portal.users;
DROP POLICY IF EXISTS "users_admin_delete"            ON portal.users;
CREATE POLICY "users_admin_delete_only"
ON portal.users FOR DELETE
TO authenticated
USING (portal.is_admin());

-- ─── portal.users — INSERT (signup) — bloqueia escalada via INSERT ────────────
DROP POLICY IF EXISTS "users_insert_self"             ON portal.users;
DROP POLICY IF EXISTS "users_insert"                  ON portal.users;
CREATE POLICY "users_insert_self_safe"
ON portal.users FOR INSERT
TO authenticated
WITH CHECK (
  auth_user_id = auth.uid()
  AND role IN ('user', 'pending')        -- nunca admin via signup
  AND status IN ('pending', 'approved')  -- pendente por default
);

CREATE POLICY "users_admin_insert"
ON portal.users FOR INSERT
TO authenticated
WITH CHECK (portal.is_admin());

-- ─── portal.users — SELECT — admin tudo, user própria + sua client_slug ───────
DROP POLICY IF EXISTS "users_select_all"              ON portal.users;
DROP POLICY IF EXISTS "users_select_own"              ON portal.users;
DROP POLICY IF EXISTS "users_select"                  ON portal.users;

CREATE POLICY "users_admin_select_all"
ON portal.users FOR SELECT
TO authenticated
USING (portal.is_admin());

CREATE POLICY "users_select_own"
ON portal.users FOR SELECT
TO authenticated
USING (auth_user_id = auth.uid());

-- ─── portal.clients — SELECT — admin tudo, user só seu próprio slug ───────────
DROP POLICY IF EXISTS "clients_read_authenticated"    ON portal.clients;
DROP POLICY IF EXISTS "clients_select_all"            ON portal.clients;
DROP POLICY IF EXISTS "clients_read"                  ON portal.clients;

CREATE POLICY "clients_admin_select_all"
ON portal.clients FOR SELECT
TO authenticated
USING (portal.is_admin());

CREATE POLICY "clients_select_own_slug"
ON portal.clients FOR SELECT
TO authenticated
USING (
  slug = (SELECT client_slug FROM portal.users WHERE auth_user_id = auth.uid())
);

-- ─── portal.clients — INSERT/UPDATE/DELETE só admin ───────────────────────────
DROP POLICY IF EXISTS "clients_admin_write"           ON portal.clients;
DROP POLICY IF EXISTS "clients_insert"                ON portal.clients;
DROP POLICY IF EXISTS "clients_update"                ON portal.clients;
DROP POLICY IF EXISTS "clients_delete"                ON portal.clients;

CREATE POLICY "clients_admin_insert" ON portal.clients FOR INSERT TO authenticated WITH CHECK (portal.is_admin());
CREATE POLICY "clients_admin_update" ON portal.clients FOR UPDATE TO authenticated USING (portal.is_admin()) WITH CHECK (portal.is_admin());
CREATE POLICY "clients_admin_delete" ON portal.clients FOR DELETE TO authenticated USING (portal.is_admin());

-- ─── portal.users — proteção extra contra XSS via name (CHECK constraint) ─────
ALTER TABLE portal.users
  DROP CONSTRAINT IF EXISTS users_name_no_html;
ALTER TABLE portal.users
  ADD CONSTRAINT users_name_no_html
  CHECK (name !~ '[<>]');

-- ─── Confirmar que RLS está ON nas tabelas críticas ───────────────────────────
ALTER TABLE portal.users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.clients ENABLE ROW LEVEL SECURITY;

-- ─── Verificação final (rode pra confirmar) ───────────────────────────────────
-- SELECT polname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'portal';
