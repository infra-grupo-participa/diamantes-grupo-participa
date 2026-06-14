-- ============================================================================
-- 033_renovacao_cobranca_mais_30.sql
-- ----------------------------------------------------------------------------
-- Corrige a régua de renovação por setor.
--
-- ANTES (005): access_until = GREATEST(COALESCE(atual, cobrança), cobrança) + 30
--   Para assinatura RECORRENTE (Hotmart cobra todo mês), quando o access_until
--   vigente já está no futuro, a regra soma +30 EM CIMA do saldo futuro. Cada
--   cobrança mensal empurra a data ~30 dias adiante → o acesso "foge" meses à
--   frente do real, distorce next_billing_date e mascara cancelamentos.
--   (Evidência 12/06/2026: willian-loro/td9xav44 cobrado 12/06 virou 29/08,
--    pois somou 30 sobre o saldo 30/07.)
--
-- DEPOIS (esta migration): access_until = GREATEST(atual, cobrança + 30)
--   Cada cobrança FIXA o acesso em "cobrança + 30 dias" (fiel à recorrência),
--   sem acumular. O GREATEST com o atual só serve para NUNCA REDUZIR o acesso
--   caso uma cobrança antiga seja reprocessada/reenviada (retry de webhook).
--   No fluxo recorrente normal, o resultado é sempre "última cobrança + 30".
--
-- NÃO altera matching, upsert de services nem o trigger de recalc. Só muda a
-- expressão v_new_access_until.
--
-- Pré-requisito: aplicar ANTES da 034/035 (que dependem desta régua).
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
        raw_payload = EXCLUDED.raw_payload,
        -- agora também preenche client_slug se a linha existente estava órfã
        client_slug = COALESCE(portal.hotmart_purchases.client_slug, EXCLUDED.client_slug)
    RETURNING id INTO v_purchase_id;

    IF v_client_slug IS NOT NULL AND p_status IN ('approved', 'complete') THEN
        v_service_name := COALESCE(v_offer.service_name, p_service_name);

        SELECT access_until INTO v_current_access
        FROM portal.services
        WHERE client_slug = v_client_slug AND offer_code = p_offer_code
        LIMIT 1;

        -- RÉGUA FIEL À RECORRÊNCIA:
        --   access_until = cobrança + 30, nunca reduzindo o saldo atual.
        --   (no fluxo mensal normal isto equivale a "última cobrança + 30")
        v_new_access_until := GREATEST(
            COALESCE(v_current_access, p_charged_at::date + 30),
            p_charged_at::date + 30
        );

        IF p_offer_code IS NOT NULL AND p_offer_code <> '' THEN
            UPDATE portal.services
               SET service_type  = v_service_name,
                   status        = 'active',
                   offer_code    = p_offer_code,
                   access_until  = v_new_access_until,
                   canceled_at   = NULL,
                   updated_at    = now()
             WHERE client_slug = v_client_slug AND offer_code = p_offer_code;

            IF NOT FOUND THEN
                INSERT INTO portal.services (client_slug, service_type, status, offer_code, access_until, metadata)
                VALUES (
                    v_client_slug, v_service_name, 'active', p_offer_code, v_new_access_until,
                    jsonb_build_object(
                        'offer_code', p_offer_code,
                        'monthly_value', p_amount,
                        'generation', COALESCE(v_offer.generation, 'hotmart'),
                        'hotmart_tx', p_transaction_code
                    )
                );
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'purchase_id', v_purchase_id,
        'client_slug', v_client_slug,
        'matched', v_client_slug IS NOT NULL,
        'new_access_until', v_new_access_until
    );
END;
$$;

COMMENT ON FUNCTION portal.process_hotmart_purchase IS
'Webhook Hotmart. Renova access_until por setor = GREATEST(atual, cobrança+30) (fiel à recorrência, sem acumular; nunca reduz). MRR/next_billing recalculados via trigger em services. ON CONFLICT preenche client_slug órfão.';

-- ============================================================================
-- Fim 033_renovacao_cobranca_mais_30.sql
-- ============================================================================
