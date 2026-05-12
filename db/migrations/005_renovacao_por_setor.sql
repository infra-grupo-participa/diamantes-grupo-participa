-- ============================================================================
-- 005_renovacao_por_setor.sql
-- Renovação por setor: cada serviço (Tráfego, Web Designer, etc.) tem ciclo
-- de cobrança independente.
-- ----------------------------------------------------------------------------
-- Decisões alinhadas:
--   - Regra "dias restantes + 30": novo access_until = max(atual, hoje) + 30
--   - subscriptions continua agregada (1 linha/cliente). next_billing_date
--     reflete MIN(access_until) dos serviços ativos. status reflete pior caso.
--   - View v_service_renewals dá a visão plana por serviço pra UI admin.
-- ----------------------------------------------------------------------------
-- Aplicado também via MCP apply_migration.
-- ============================================================================

-- ============================================================================
-- 1) process_hotmart_purchase — nova regra de renovação por setor
-- ----------------------------------------------------------------------------
-- Antes: access_until = fim do mês seguinte (regra antiga "fim do mês")
-- Agora: access_until = GREATEST(current_access_until, charged_at) + 30 dias
--   - Renovação antecipada (current_access_until > charged_at): preserva
--     dias restantes (10/06 → paga 05/06 → vira 10/07)
--   - Renovação atrasada (current_access_until < charged_at): perde os dias
--     atrasados (10/06 → paga 15/06 → vira 10/06 + 30 = 10/07)
--     (opção (a) alinhada com cliente: incentivo a pagar em dia)
--   - Primeira compra: current_access_until é NULL → usa charged_at + 30
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.process_hotmart_purchase(
    p_transaction_code text, p_buyer_email text, p_offer_code text,
    p_service_name text, p_amount numeric, p_status text,
    p_payment_type text, p_installments_total integer, p_installment_number integer,
    p_charged_at timestamp with time zone, p_raw_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
    v_client_slug        text;
    v_offer              portal.hotmart_offers%ROWTYPE;
    v_purchase_id        uuid;
    v_current_access     date;
    v_new_access_until   date;
    v_service_name       text;
BEGIN
    SELECT client_slug INTO v_client_slug
    FROM portal.users
    WHERE lower(email) = lower(p_buyer_email) AND role = 'user'
    LIMIT 1;

    SELECT * INTO v_offer FROM portal.hotmart_offers WHERE offer_code = p_offer_code;

    INSERT INTO portal.hotmart_purchases (
        transaction_code, buyer_email, offer_code, service_name,
        amount, status, payment_type, installments_total, installment_number,
        client_slug, charged_at, raw_payload
    ) VALUES (
        p_transaction_code, lower(p_buyer_email), p_offer_code, p_service_name,
        p_amount, p_status, p_payment_type, p_installments_total, p_installment_number,
        v_client_slug, p_charged_at, p_raw_payload
    )
    ON CONFLICT (transaction_code) DO UPDATE SET
        status      = EXCLUDED.status,
        raw_payload = EXCLUDED.raw_payload
    RETURNING id INTO v_purchase_id;

    IF v_client_slug IS NOT NULL AND p_status IN ('approved', 'complete') THEN
        v_service_name := COALESCE(v_offer.service_name, p_service_name);

        -- Renovação por setor: lê access_until atual do serviço deste offer_code
        SELECT access_until INTO v_current_access
        FROM portal.services
        WHERE client_slug = v_client_slug
          AND offer_code  = p_offer_code
        LIMIT 1;

        -- Regra "dias restantes + 30":
        -- - se atual > hoje (renovação antecipada): atual + 30
        -- - se atual <= hoje OU NULL (renovação atrasada ou primeira): hoje + 30
        v_new_access_until := GREATEST(
            COALESCE(v_current_access, p_charged_at::date),
            p_charged_at::date
        ) + 30;

        IF p_offer_code IS NOT NULL AND p_offer_code <> '' THEN
            UPDATE portal.services
               SET service_type  = v_service_name,
                   status        = 'active',
                   offer_code    = p_offer_code,
                   access_until  = v_new_access_until,
                   canceled_at   = NULL,
                   updated_at    = now()
             WHERE client_slug = v_client_slug
               AND offer_code  = p_offer_code;

            IF NOT FOUND THEN
                INSERT INTO portal.services (client_slug, service_type, status, offer_code, access_until, metadata)
                VALUES (
                    v_client_slug,
                    v_service_name,
                    'active',
                    p_offer_code,
                    v_new_access_until,
                    jsonb_build_object(
                        'offer_code',    p_offer_code,
                        'monthly_value', p_amount,
                        'generation',    COALESCE(v_offer.generation, 'hotmart'),
                        'hotmart_tx',    p_transaction_code
                    )
                );
            END IF;
        END IF;

        -- Recalc da subscription agregada (MRR + next_billing_date + status)
        -- é feita pelo trigger trg_services_recalc_subscription abaixo.
    END IF;

    RETURN jsonb_build_object(
        'ok',                true,
        'purchase_id',       v_purchase_id,
        'client_slug',       v_client_slug,
        'matched',           v_client_slug IS NOT NULL,
        'new_access_until',  v_new_access_until
    );
END;
$$;

COMMENT ON FUNCTION portal.process_hotmart_purchase IS 'Webhook handler Hotmart. Renova access_until por setor (dias restantes + 30). MRR/next_billing_date são recalculados via trigger em services.';

-- ============================================================================
-- 2) recalc_subscription_from_services — coração da agregação
-- ----------------------------------------------------------------------------
-- Lê services ativos do cliente, calcula:
--   - next_billing_date = MIN(access_until) entre ativos com offer_code
--   - monthly_value = SUM(hotmart_offers.monthly_value) dos ativos
--   - status:
--       * Sem serviço ativo → 'canceled'
--       * Algum access_until < hoje - 3d (margem webhook) → 'overdue'
--       * Resto → 'paid'
-- Idempotente: chamar várias vezes sempre dá o mesmo resultado.
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.recalc_subscription_from_services(p_client_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
    v_next_billing date;
    v_mrr          numeric;
    v_min_access   date;
    v_active_count int;
    v_new_status   text;
    v_today        date := CURRENT_DATE;
BEGIN
    -- Agrega serviços ativos com offer_code (ignora HOST, manual, etc)
    SELECT
        COUNT(*),
        MIN(s.access_until),
        COALESCE(SUM(o.monthly_value), 0)
    INTO v_active_count, v_min_access, v_mrr
    FROM portal.services s
    LEFT JOIN portal.hotmart_offers o ON o.offer_code = s.offer_code
    WHERE s.client_slug = p_client_slug
      AND s.status = 'active'
      AND s.offer_code IS NOT NULL
      AND s.offer_code <> '';

    -- Determina status
    IF v_active_count = 0 THEN
        v_new_status := 'canceled';
        v_next_billing := NULL;
    ELSIF v_min_access IS NOT NULL AND v_min_access < (v_today - interval '3 days')::date THEN
        v_new_status := 'overdue';
        v_next_billing := v_min_access;
    ELSE
        v_new_status := 'paid';
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
        'next_billing_date', v_next_billing,
        'monthly_value',     v_mrr,
        'status',            v_new_status
    );
END;
$$;

GRANT EXECUTE ON FUNCTION portal.recalc_subscription_from_services(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal.recalc_subscription_from_services(text) FROM anon;

COMMENT ON FUNCTION portal.recalc_subscription_from_services IS 'Recalcula MRR, next_billing_date e status da subscription com base nos services ativos. Trigger dispara automaticamente em INSERT/UPDATE de services.';

-- ============================================================================
-- 3) Trigger em services: dispara recalc da subscription
-- ----------------------------------------------------------------------------
-- Atua em INSERT/UPDATE/DELETE de services. Como recalc é leve (uma query
-- agregada), tudo bem disparar sempre. Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION portal._trg_services_recalc_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
DECLARE
    v_slug text;
BEGIN
    v_slug := COALESCE(NEW.client_slug, OLD.client_slug);
    IF v_slug IS NOT NULL THEN
        PERFORM portal.recalc_subscription_from_services(v_slug);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_services_recalc_subscription ON portal.services;
CREATE TRIGGER trg_services_recalc_subscription
    AFTER INSERT OR UPDATE OR DELETE ON portal.services
    FOR EACH ROW
    EXECUTE FUNCTION portal._trg_services_recalc_subscription();

-- ============================================================================
-- 4) sync_overdue_subscriptions — simplificada (delegada à view)
-- ----------------------------------------------------------------------------
-- A nova lógica deixa o status sempre derivado dos services. O cron antigo
-- ainda pode rodar pra forçar recálculo de todos os clientes (drift).
-- ============================================================================

CREATE OR REPLACE FUNCTION portal.sync_overdue_subscriptions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'portal'
AS $$
BEGIN
    -- Roda recalc em todos os clientes que têm subscription
    PERFORM portal.recalc_subscription_from_services(client_slug)
    FROM portal.subscriptions;
END;
$$;

COMMENT ON FUNCTION portal.sync_overdue_subscriptions IS 'Drift-correction: recalcula subscription de todos os clientes a partir dos services. Roda no cron diário.';

-- ============================================================================
-- 5) View v_service_renewals — visão plana por serviço (UI admin)
-- ----------------------------------------------------------------------------
-- Lista 1 linha por (cliente × serviço ativo) ordenada por proximidade do
-- vencimento. Inclui monthly_value individual da oferta.
-- security_invoker=on respeita RLS de services/clients/hotmart_offers.
-- ============================================================================

CREATE OR REPLACE VIEW portal.v_service_renewals
WITH (security_invoker = on)
AS
SELECT
    s.id                                    AS service_id,
    s.client_slug,
    c.display_name                          AS client_display_name,
    s.service_type,
    s.offer_code,
    s.status                                AS service_status,
    s.access_until,
    (s.access_until - CURRENT_DATE)         AS days_left,
    o.monthly_value                         AS monthly_value,
    o.service_name                          AS offer_service_name,
    o.generation,
    s.updated_at
FROM portal.services s
JOIN portal.clients c           ON c.slug = s.client_slug
LEFT JOIN portal.hotmart_offers o ON o.offer_code = s.offer_code
WHERE s.status = 'active'
  AND s.offer_code IS NOT NULL
  AND s.offer_code <> '';

GRANT SELECT ON portal.v_service_renewals TO authenticated;

COMMENT ON VIEW portal.v_service_renewals IS 'Visão plana de renovações por serviço. 1 linha por (cliente × serviço ativo). Ordenar por access_until ASC pra próximos vencimentos.';

-- ============================================================================
-- 6) Backfill: roda recalc em todos os clientes existentes
-- ----------------------------------------------------------------------------
-- Garante que após esta migration, subscriptions já estejam coerentes com a
-- nova lógica. Pode ajustar status/next_billing/mrr de alguns clientes.
-- ============================================================================

SELECT portal.recalc_subscription_from_services(client_slug)
FROM portal.subscriptions;

-- ============================================================================
-- Fim 005_renovacao_por_setor.sql
-- ============================================================================
