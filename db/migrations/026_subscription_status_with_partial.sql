-- ============================================================================
-- 026_subscription_status_with_partial.sql
-- ----------------------------------------------------------------------------
-- Atualiza portal.recalc_subscription_from_services para incluir o estado
-- 'partial' (mix de services active + delinquent) e instala cron diário
-- para corrigir drift de status independentemente de mudanças em services.
--
-- ANTES (migration 005):
--   - Sem serviço ativo → 'canceled'
--   - access_until < hoje-3d → 'overdue'
--   - resto → 'paid'
--   Resultado: clientes com mix (active + delinquent) eram marcados 'paid',
--   escondendo a inadimplência parcial. E status só era recalculado quando
--   alguém tocava em services (nenhum cron diário rodava sync_overdue).
--
-- DEPOIS:
--   - Nenhum service active nem delinquent (com offer_code) → 'canceled'
--   - Todos delinquent ou todos vencidos → 'overdue'
--   - Mix de active + delinquent (ou algum vencido entre ativos)  → 'partial'
--   - Todos active e nenhum vencido → 'paid'
--   Plus: cron diário em 04:00 UTC roda sync_overdue_subscriptions().
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.recalc_subscription_from_services(p_client_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
    v_next_billing  date;
    v_mrr           numeric;
    v_min_access    date;
    v_active_count  int;
    v_delinq_count  int;
    v_expired_count int;
    v_new_status    text;
    v_today         date := CURRENT_DATE;
    v_margin        date := (CURRENT_DATE - interval '3 days')::date;
BEGIN
    -- Agrega counters dos services com offer_code (HOST, manuais ficam fora)
    -- MRR = active + delinquent: representa contrato vigente. O status indica
    -- que parte do MRR está em atraso, mas o valor contratado segue cheio.
    SELECT
        COUNT(*) FILTER (WHERE s.status = 'active'),
        COUNT(*) FILTER (WHERE s.status = 'delinquent'),
        COUNT(*) FILTER (WHERE s.status = 'active' AND s.access_until IS NOT NULL AND s.access_until < v_margin),
        MIN(s.access_until) FILTER (WHERE s.status = 'active'),
        COALESCE(SUM(o.monthly_value) FILTER (WHERE s.status IN ('active','delinquent')), 0)
    INTO v_active_count, v_delinq_count, v_expired_count, v_min_access, v_mrr
    FROM portal.services s
    LEFT JOIN portal.hotmart_offers o ON o.offer_code = s.offer_code
    WHERE s.client_slug = p_client_slug
      AND s.offer_code IS NOT NULL
      AND s.offer_code <> '';

    IF v_active_count = 0 AND v_delinq_count = 0 THEN
        -- Nenhum serviço relevante (só HOST/cancelados/etc).
        v_new_status   := 'canceled';
        v_next_billing := NULL;
    ELSIF v_active_count = 0 OR (v_active_count = v_expired_count AND v_delinq_count > 0) THEN
        -- Tudo delinquent, ou os poucos ativos já estouraram a margem.
        v_new_status   := 'overdue';
        v_next_billing := v_min_access;
    ELSIF v_delinq_count > 0 OR v_expired_count > 0 THEN
        -- Mix: pelo menos um ativo saudável + pelo menos um delinquent/vencido.
        v_new_status   := 'partial';
        v_next_billing := v_min_access;
    ELSE
        v_new_status   := 'paid';
        v_next_billing := v_min_access;
    END IF;

    UPDATE portal.subscriptions
       SET monthly_value     = v_mrr,
           next_billing_date = v_next_billing,
           status            = v_new_status,
           updated_at        = now()
     WHERE client_slug = p_client_slug;

    RETURN jsonb_build_object(
        'ok',                true,
        'client_slug',       p_client_slug,
        'active_count',      v_active_count,
        'delinquent_count',  v_delinq_count,
        'expired_count',     v_expired_count,
        'next_billing_date', v_next_billing,
        'monthly_value',     v_mrr,
        'status',            v_new_status
    );
END;
$$;

COMMENT ON FUNCTION portal.recalc_subscription_from_services IS
'Recalcula MRR, next_billing_date e status da subscription a partir dos services. Status: canceled (nada) / overdue (tudo vencido/delinquent) / partial (mix active+delinquent ou ativo vencido) / paid (tudo em dia). Trigger em services dispara, cron diário corrige drift.';

-- ----------------------------------------------------------------------------
-- Cron diário 04:00 UTC: recalcula todas as subscriptions
-- (drift correction independente de mudança em services)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Remove job antigo se existir (idempotência)
        PERFORM cron.unschedule(jobid)
        FROM cron.job
        WHERE command ILIKE '%sync_overdue_subscriptions%';

        PERFORM cron.schedule(
            'portal-sync-overdue-subscriptions',
            '0 4 * * *',
            $cron$ SELECT portal.sync_overdue_subscriptions(); $cron$
        );
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Aplica a nova lógica imediatamente em todas as subscriptions existentes.
-- ----------------------------------------------------------------------------
SELECT portal.sync_overdue_subscriptions();
