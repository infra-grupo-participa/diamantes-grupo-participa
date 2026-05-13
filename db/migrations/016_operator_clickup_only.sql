-- ============================================================================
-- 016_operator_clickup_only.sql
-- Separação operador/usuário: portal.operators como tabela própria.
-- Operadores deixam de ter acesso autenticado ao sistema — interagem só no ClickUp.
-- ----------------------------------------------------------------------------
-- Objetivos:
--   1. Criar portal.operators (cadastro operacional, sem auth_user_id)
--   2. Backfill: copiar portal.users WHERE role='operator' para portal.operators
--   3. Criar portal.demand_operators (substitui demand_members com role='operator')
--   4. Backfill: migrar demand_members com role='operator' para demand_operators
--   5. Atualizar team_assignments para suportar operator_id (nova coluna)
--   6. Atualizar trigger handle_new_auth_user: role='operator' vira 'pending'
--   7. Desabilitar operadores ativos em portal.users (status='disabled')
--   8. RLS: operadores não têm policy de acesso autenticado
-- ============================================================================

-- ============================================================================
-- 1) Tabela portal.operators
-- ============================================================================

CREATE TABLE IF NOT EXISTS portal.operators (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  email            text,
  position_id      uuid REFERENCES portal.positions(id) ON DELETE SET NULL,
  clickup_user_id  text,
  contract_active  boolean NOT NULL DEFAULT true,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive', 'suspended')),
  metadata         jsonb NOT NULL DEFAULT '{}',
  points_score     numeric(10,2) NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE portal.operators IS
  'Cadastro operacional da equipe. Sem acesso autenticado ao sistema — interagem via ClickUp.';

ALTER TABLE portal.operators ENABLE ROW LEVEL SECURITY;

-- Apenas admin lê e escreve
DROP POLICY IF EXISTS "operators_admin_all" ON portal.operators;
CREATE POLICY "operators_admin_all"
  ON portal.operators FOR ALL
  TO authenticated
  USING (portal.is_admin())
  WITH CHECK (portal.is_admin());

-- ============================================================================
-- 2) Backfill: portal.users role='operator' → portal.operators
-- ============================================================================

INSERT INTO portal.operators (
  id,
  name,
  email,
  position_id,
  clickup_user_id,
  contract_active,
  status,
  metadata,
  points_score,
  created_at,
  updated_at
)
SELECT
  id,
  COALESCE(name, ''),
  email,
  position_id,
  clickup_user_id,
  COALESCE(contract_active, true),
  CASE
    WHEN status = 'approved' THEN 'active'
    WHEN status = 'disabled' THEN 'inactive'
    ELSE 'inactive'
  END,
  COALESCE(metadata, '{}'),
  COALESCE(points_score, 0),
  created_at,
  updated_at
FROM portal.users
WHERE role = 'operator'
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3) Tabela portal.demand_operators
-- ----------------------------------------------------------------------------
-- Relaciona demandas a operadores (substitui demand_members role='operator').
-- Mantém demand_members para a relação cliente↔demanda (role='client').
-- ============================================================================

CREATE TABLE IF NOT EXISTS portal.demand_operators (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id   uuid NOT NULL REFERENCES portal.demands(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES portal.operators(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'operator',
  added_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (demand_id, operator_id)
);

COMMENT ON TABLE portal.demand_operators IS
  'Operadores atribuídos a cada demanda. Separado de demand_members (que fica para clientes).';

CREATE INDEX IF NOT EXISTS idx_demand_operators_demand ON portal.demand_operators(demand_id);
CREATE INDEX IF NOT EXISTS idx_demand_operators_operator ON portal.demand_operators(operator_id);

ALTER TABLE portal.demand_operators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "demand_operators_admin_all" ON portal.demand_operators;
CREATE POLICY "demand_operators_admin_all"
  ON portal.demand_operators FOR ALL
  TO authenticated
  USING (portal.is_admin())
  WITH CHECK (portal.is_admin());

-- ============================================================================
-- 4) Backfill: demand_members role='operator' → demand_operators
-- ----------------------------------------------------------------------------
-- demand_members.user_id aponta para portal.users; se o user_id existe em
-- portal.operators (copiamos com mesmo ID), migra. Ignora membros cujo
-- user_id não foi migrado (casos de operadores removidos/incompletos).
-- ============================================================================

INSERT INTO portal.demand_operators (demand_id, operator_id, role, added_at)
SELECT dm.demand_id, dm.user_id, 'operator', dm.added_at
FROM portal.demand_members dm
WHERE dm.role = 'operator'
  AND EXISTS (SELECT 1 FROM portal.operators o WHERE o.id = dm.user_id)
ON CONFLICT (demand_id, operator_id) DO NOTHING;

-- ============================================================================
-- 5) Adicionar operator_id em team_assignments
-- ----------------------------------------------------------------------------
-- Mantém user_id (compatibilidade com assignments antigos ligados a users).
-- Novos assignments de operadores devem usar operator_id.
-- ============================================================================

ALTER TABLE portal.team_assignments
  ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES portal.operators(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_team_assignments_operator
  ON portal.team_assignments(operator_id)
  WHERE operator_id IS NOT NULL;

-- Backfill team_assignments: onde user_id existe em operators, preenche operator_id
UPDATE portal.team_assignments ta
SET operator_id = u.id
FROM portal.users u
WHERE ta.user_id = u.id
  AND u.role = 'operator'
  AND ta.operator_id IS NULL;

-- ============================================================================
-- 6) Atualizar trigger handle_new_auth_user
-- ----------------------------------------------------------------------------
-- role='operator' via signup externo agora cai como 'pending' (não aprovado).
-- Apenas role='admin' tem aprovação automática.
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal', 'public'
AS $$
DECLARE
  v_role   text;
  v_status text;
  v_name   text;
  v_email  text;
BEGIN
  v_role  := COALESCE(NEW.raw_user_meta_data->>'role', 'user');
  v_name  := COALESCE(NEW.raw_user_meta_data->>'name', '');
  v_email := COALESCE(NEW.email, '');

  -- Apenas admin tem aprovação automática.
  -- role='operator' via signup externo cai como pending (sem acesso ao portal).
  IF v_role = 'admin' THEN
    v_status := 'approved';
  ELSE
    v_status := 'pending';
  END IF;

  INSERT INTO portal.users (auth_user_id, email, name, role, status)
  VALUES (NEW.id, v_email, v_name, v_role, v_status)
  ON CONFLICT (auth_user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 7) Desabilitar operadores em portal.users
-- ----------------------------------------------------------------------------
-- Preserva histórico (não deleta). Status 'disabled' bloqueia login via
-- auth-guard.js e portal-auth-v2.js.
-- ============================================================================

UPDATE portal.users
SET status = 'disabled', updated_at = now()
WHERE role = 'operator'
  AND status IN ('approved', 'pending');

-- ============================================================================
-- 8) View admin: v_operators (substitui a leitura de users role='operator')
-- ============================================================================

CREATE OR REPLACE VIEW portal.v_operators
WITH (security_invoker = on)
AS
SELECT
  o.id,
  o.name,
  o.email,
  o.position_id,
  p.name                                     AS position_name,
  p.color                                    AS position_color,
  o.clickup_user_id,
  o.contract_active,
  o.status,
  o.points_score,
  o.metadata,
  o.created_at,
  o.updated_at,
  COUNT(DISTINCT ta.client_slug)::int        AS students_count,
  COUNT(DISTINCT do_.demand_id)::int          AS demands_count,
  ROUND(AVG(r.score)::numeric / 2.0, 2)      AS rating_avg
FROM portal.operators o
LEFT JOIN portal.positions          p   ON p.id = o.position_id
LEFT JOIN portal.team_assignments   ta  ON ta.operator_id = o.id
LEFT JOIN portal.demand_operators   do_ ON do_.operator_id = o.id
LEFT JOIN portal.ratings            r   ON r.user_id = o.id
GROUP BY o.id, p.name, p.color;

GRANT SELECT ON portal.v_operators TO authenticated;

-- ============================================================================
-- Fim 016_operator_clickup_only.sql
-- ============================================================================
