-- 045_email_log_dedup_key — dedup "uma vez só" via dedup_key explícito; e-mails
-- recorrentes (chat) ficam sem dedup_key e são limitados por janela (cooldown) na EF.
-- Aplicada via MCP em npqyvjhvtfahuxfmuhie.
ALTER TABLE portal.email_log ADD COLUMN IF NOT EXISTS dedup_key text;

DROP INDEX IF EXISTS portal.uq_email_log_sent;

-- Unicidade só pra eventos "once-ever" (dedup_key preenchido + enviado).
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_log_dedup
  ON portal.email_log(dedup_key) WHERE dedup_key IS NOT NULL AND status = 'sent';

-- Consulta de cooldown por (type, ref_id, destinatário).
CREATE INDEX IF NOT EXISTS idx_email_log_throttle
  ON portal.email_log(type, ref_id, to_email, created_at DESC);

COMMENT ON COLUMN portal.email_log.dedup_key IS 'Chave de dedup para eventos únicos (ex.: demanda_criada:<id>). NULL para recorrentes (chat), que usam janela de tempo.';
