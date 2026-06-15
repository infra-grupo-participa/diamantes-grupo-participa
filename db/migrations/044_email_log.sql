-- 044_email_log — auditoria + dedup dos e-mails transacionais (Resend).
-- Aplicada via MCP em npqyvjhvtfahuxfmuhie.
CREATE TABLE IF NOT EXISTS portal.email_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL,                 -- 'demanda_criada' | 'nova_mensagem' | ...
  to_email    text NOT NULL,
  subject     text,
  ref_type    text,                          -- 'demand' | 'message' | ...
  ref_id      text,                          -- id da entidade (dedup)
  status      text NOT NULL DEFAULT 'sent'   CHECK (status IN ('sent','failed','skipped')),
  resend_id   text,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Dedup: no máximo 1 e-mail por (type, ref_id) que tenha sido ENVIADO.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_log_sent
  ON portal.email_log(type, ref_id) WHERE ref_id IS NOT NULL AND status = 'sent';

CREATE INDEX IF NOT EXISTS idx_email_log_created ON portal.email_log(created_at DESC);

ALTER TABLE portal.email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_log_admin ON portal.email_log;
CREATE POLICY email_log_admin ON portal.email_log
  FOR SELECT TO authenticated USING (portal.is_admin());

COMMENT ON TABLE portal.email_log IS 'Auditoria e dedup dos e-mails transacionais enviados via Resend (Edge Function send-email).';
