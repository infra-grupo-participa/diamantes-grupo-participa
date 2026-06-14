-- ============================================================================
-- 037_cron_expire_ratings.sql
-- ----------------------------------------------------------------------------
-- GARANTIA do ciclo de avaliação: agenda a expiração automática de convites
-- de avaliação pendentes. Antes, expire_pending_ratings() existia (008) mas
-- NADA a executava — pendentes ficavam pendentes para sempre.
--
-- Aqui:
--   - estende expire_pending_ratings() para também expirar project_ratings;
--   - janelas: demanda 7 dias (mantido), PROJETO 14 dias (decisão de produto);
--   - agenda pg_cron diário (mesmo padrão da 026 para overdue).
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.expire_pending_ratings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
  v_client_expired  int;
  v_oper_expired    int;
  v_project_expired int;
BEGIN
  -- Avaliação cliente→operador (por demanda): 7 dias
  WITH upd AS (
    UPDATE portal.ratings
       SET status = 'expired'
     WHERE status = 'pending'
       AND created_at < now() - interval '7 days'
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_client_expired FROM upd;

  -- Avaliação operador→cliente: 7 dias
  WITH upd AS (
    UPDATE portal.operator_to_client_ratings
       SET status = 'expired'
     WHERE status = 'pending'
       AND created_at < now() - interval '7 days'
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_oper_expired FROM upd;

  -- Avaliação de PROJETO (CSAT de fechamento): 14 dias
  WITH upd AS (
    UPDATE portal.project_ratings
       SET status = 'expired'
     WHERE status = 'pending'
       AND created_at < now() - interval '14 days'
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_project_expired FROM upd;

  RETURN jsonb_build_object(
    'ok', true,
    'client_ratings_expired',   v_client_expired,
    'operator_ratings_expired', v_oper_expired,
    'project_ratings_expired',  v_project_expired,
    'ran_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION portal.expire_pending_ratings() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION portal.expire_pending_ratings() TO authenticated;

COMMENT ON FUNCTION portal.expire_pending_ratings IS
  'Expira convites de avaliação pendentes: demanda/operador 7d, projeto 14d. Agendado via pg_cron diário (05:10 UTC).';

-- ─────────────────────────────────────────────
-- Agenda pg_cron diário (idempotente). Se pg_cron não existir no projeto,
-- o bloco apenas não agenda — rode a função por outro scheduler.
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE command ILIKE '%expire_pending_ratings%';

    PERFORM cron.schedule(
      'portal-expire-pending-ratings',
      '10 5 * * *',
      $cron$ SELECT portal.expire_pending_ratings(); $cron$
    );
  END IF;
END $$;

-- Roda uma vez agora para limpar pendências antigas acumuladas.
SELECT portal.expire_pending_ratings();

-- ============================================================================
-- Fim 037_cron_expire_ratings.sql
-- ============================================================================
