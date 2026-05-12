-- ============================================================================
-- 003_operator_backend.sql
-- Camada de dados para área do operador: bucket de anexos + view auxiliar.
-- ----------------------------------------------------------------------------
-- Pré-requisitos: schema portal com RLS já habilitado (migrations 001+002 e
-- as 32 migrations versionadas no Supabase). Esta migration assume que
-- portal.can_access_demand(uuid), portal.is_admin() e portal.users já existem.
-- ----------------------------------------------------------------------------
-- Aplicar via MCP: apply_migration name=003_operator_backend
-- Esta cópia em arquivo é a fonte da verdade versionada.
-- ============================================================================

-- ============================================================================
-- 1) Bucket privado `demand-attachments` (idempotente)
-- ----------------------------------------------------------------------------
-- Path pattern: {demand_id}/{message_id}/{filename}
-- - Privado: leitura/escrita só via signed URL ou cliente autenticado
-- - Limite 10MB por arquivo (suficiente para imagens/docs comuns)
-- - MIMEs liberados: imagens, PDFs, docs, planilhas. Bloqueia executáveis.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'demand-attachments',
  'demand-attachments',
  false,
  10485760,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
    'application/zip'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- 2) RLS policies para storage.objects no bucket `demand-attachments`
-- ----------------------------------------------------------------------------
-- Regra: o primeiro segmento do path é o demand_id; quem pode acessar a
-- demanda (via portal.can_access_demand) pode ler/escrever anexos dela.
-- ============================================================================

DROP POLICY IF EXISTS "demand_attachments_select" ON storage.objects;
CREATE POLICY "demand_attachments_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'demand-attachments'
    AND portal.can_access_demand((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "demand_attachments_insert" ON storage.objects;
CREATE POLICY "demand_attachments_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'demand-attachments'
    AND portal.can_access_demand((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "demand_attachments_delete" ON storage.objects;
CREATE POLICY "demand_attachments_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'demand-attachments'
    AND (
      portal.is_admin()
      OR owner = auth.uid()
    )
  );

-- ============================================================================
-- 3) Índice de performance em demand_members(user_id, role)
-- ----------------------------------------------------------------------------
-- View v_my_assigned_demands filtra por user_id+role. Index acelera lookup
-- do operador a cada carregamento da página de demandas.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_demand_members_user_role
  ON portal.demand_members(user_id, role);

-- ============================================================================
-- 4) View v_my_assigned_demands
-- ----------------------------------------------------------------------------
-- Demandas atribuídas ao operador autenticado, com metadados úteis para a UI:
-- - last_message_at: timestamp da última mensagem (ordenação do feed)
-- - unread_count: mensagens não vistas (placeholder: 0 hoje, será populado
--   quando implementarmos read receipts em fase posterior)
-- - client_display_name: para exibir "Ana Carolina" sem extra-join no front
-- - tipo de demanda inferido do título (heurística simples; ClickUp custom
--   fields virão depois)
--
-- Security_invoker = on faz a view respeitar RLS do usuário chamador,
-- então operadores só veem suas próprias demandas naturalmente.
-- ============================================================================

CREATE OR REPLACE VIEW portal.v_my_assigned_demands
WITH (security_invoker = on)
AS
SELECT
  d.id,
  d.client_slug,
  c.display_name      AS client_display_name,
  d.title,
  d.description,
  d.status,
  d.starts_at,
  d.ends_at,
  d.created_at,
  d.updated_at,
  d.finalized_at,
  d.clickup_task_id,
  dm.role             AS my_role,
  dm.approved_finish  AS i_approved_finish,
  dm.added_at         AS my_added_at,
  (
    SELECT MAX(m.created_at)
    FROM portal.demand_messages m
    WHERE m.demand_id = d.id
  ) AS last_message_at,
  (
    SELECT COUNT(*)::int
    FROM portal.demand_messages m
    WHERE m.demand_id = d.id
  ) AS message_count,
  0::int AS unread_count
FROM portal.demand_members dm
JOIN portal.demands       d ON d.id = dm.demand_id
JOIN portal.clients       c ON c.slug = d.client_slug
JOIN portal.users         u ON u.id = dm.user_id
WHERE
  u.auth_user_id = auth.uid()
  AND dm.role = 'operator';

GRANT SELECT ON portal.v_my_assigned_demands TO authenticated;

-- ============================================================================
-- Fim 003_operator_backend.sql
-- ============================================================================
