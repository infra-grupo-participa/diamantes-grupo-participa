-- ============================================================================
-- 035_resync_access_until.sql
-- ----------------------------------------------------------------------------
-- Re-sincroniza access_until com a régua nova (033), limpando a inflação
-- herdada (datas em "balde" da 020 + acúmulo +30 da régua antiga).
--
-- Para cada serviço com offer_code, seta:
--     access_until = (última cobrança approved/complete daquele cliente×oferta) + 30
-- usando o histórico real em portal.hotmart_purchases.
--
-- CONSERVADOR: só toca serviços que TÊM cobrança registrada em
--   hotmart_purchases. Serviços sem histórico (ex. cobranças pré-webhook de
--   março, ou serviços manuais) NÃO são alterados — não se piora o que não há
--   como reconstruir aqui. Status individual do service também não é mexido;
--   quem ficar com access_until no passado é refletido pela subscription via
--   recalc (partial/overdue), conforme o design da 026.
--
-- Pré-requisitos: 033 (régua) e 034 (órfãs religadas) já aplicadas.
-- TRANSACIONAL: rode o PRÉ-FLIGHT (BLOCO 0) primeiro, confira o impacto, e só
-- então execute o BLOCO 1 e o COMMIT.
-- ============================================================================

-- ============================================================================
-- BLOCO 0 — PRÉ-FLIGHT (somente leitura): impacto do re-sync por serviço
-- Mostra atual vs novo e o delta. Espera-se que a maioria dos deltas seja
-- NEGATIVO (datas infladas recuando para o valor fiel).
-- ============================================================================
WITH last_charge AS (
    SELECT client_slug, offer_code, max(charged_at::date) AS last_date
    FROM portal.hotmart_purchases
    WHERE status IN ('approved','complete')
      AND client_slug IS NOT NULL
      AND offer_code IS NOT NULL AND offer_code <> ''
    GROUP BY client_slug, offer_code
)
SELECT s.client_slug, s.offer_code, s.service_type, s.status,
       s.access_until                         AS atual,
       (lc.last_date + 30)                    AS novo,
       (lc.last_date + 30) - s.access_until   AS delta_dias
FROM portal.services s
JOIN last_charge lc
  ON lc.client_slug = s.client_slug AND lc.offer_code = s.offer_code
WHERE s.offer_code IS NOT NULL AND s.offer_code <> ''
  AND s.access_until IS DISTINCT FROM (lc.last_date + 30)
ORDER BY delta_dias;

-- ============================================================================
-- BLOCO 1 — EXECUÇÃO
-- ============================================================================
BEGIN;

WITH last_charge AS (
    SELECT client_slug, offer_code, max(charged_at::date) AS last_date
    FROM portal.hotmart_purchases
    WHERE status IN ('approved','complete')
      AND client_slug IS NOT NULL
      AND offer_code IS NOT NULL AND offer_code <> ''
    GROUP BY client_slug, offer_code
)
UPDATE portal.services s
   SET access_until = lc.last_date + 30,
       updated_at   = now()
  FROM last_charge lc
 WHERE s.client_slug = lc.client_slug
   AND s.offer_code  = lc.offer_code
   AND s.offer_code IS NOT NULL AND s.offer_code <> ''
   AND s.access_until IS DISTINCT FROM (lc.last_date + 30);

-- Recalcula MRR / next_billing / status de TODAS as subscriptions
SELECT portal.sync_overdue_subscriptions();

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO
-- ----------------------------------------------------------------------------

-- Subscriptions após o re-sync (compare com o esperado do CSV)
SELECT client_slug, status, next_billing_date, monthly_value
FROM portal.subscriptions
ORDER BY next_billing_date NULLS LAST;

-- Serviços com access_until ainda no futuro distante (>40 dias) — não deveria
-- sobrar inflação relevante após o re-sync
SELECT client_slug, offer_code, service_type, access_until,
       (access_until - current_date) AS dias
FROM portal.services
WHERE offer_code IS NOT NULL AND offer_code <> ''
  AND access_until > current_date + 40
ORDER BY access_until DESC;

-- Se ok: COMMIT;  /  Se algo estranho: ROLLBACK;
-- COMMIT;
-- ROLLBACK;

-- ============================================================================
-- Fim 035_resync_access_until.sql
-- ============================================================================
