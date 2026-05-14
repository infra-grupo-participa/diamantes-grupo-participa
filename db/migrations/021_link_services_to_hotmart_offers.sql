-- ============================================================================
-- 021_link_services_to_hotmart_offers.sql
-- Popula portal.hotmart_offers com as 12 ofertas vigentes do CSV de vendas
-- de 2026-05-14 e religa portal.services.offer_code para cada par
-- (client_slug, service_key normalizado) dos 19 diamantes da verdade.
--
-- Fonte: C:\Users\infra\Downloads\sales_history_20260514161827_*.csv
-- Pré-requisito: migration 020 já commitada (services reset).
--
-- Comportamento:
--   1. UPSERT em portal.hotmart_offers das 12 ofertas (offer_code, service_name,
--      monthly_value).
--   2. UPDATE portal.services.offer_code por (client_slug, service_key)
--      conforme mapping do CSV. Inclui vendas 'Atrasado' — offer_code é a
--      chave de assinatura, não reflete pagamento; webhook do Hotmart cuida
--      do status quando a renovação chegar.
--   3. Trigger trg_services_recalc_subscription dispara automaticamente e
--      atualiza portal.subscriptions.monthly_value (MRR agregado) por cliente.
--
-- Exceção conhecida:
--   - priscila-ziliani / EDICAO_VIDEO: aparece na tabela verdade mas NÃO há
--     venda Hotmart vigente. É linkado ao offer hqhbhqhd (Edição de Vídeo
--     R$ 1.000) e marcado como status='delinquent' com access_until no
--     passado (passo 3.3b). Fica fora do MRR até a primeira venda real
--     chegar via webhook.
--
-- TRANSACIONAL. BLOCO 1 e 2 são pré-flight. BLOCO 3 executa.
-- ============================================================================

-- ============================================================================
-- BLOCO 1 — PRÉ-FLIGHT: estado atual de hotmart_offers
-- ============================================================================

SELECT offer_code, service_name, monthly_value, generation
FROM portal.hotmart_offers
ORDER BY offer_code;

-- ============================================================================
-- BLOCO 2 — PRÉ-FLIGHT: serviços sem offer_code nos 19 clientes
-- (esperado: praticamente todos, porque a 020 zerou)
-- ============================================================================

SELECT s.client_slug, s.service_type, s.status, s.offer_code, s.access_until
FROM portal.services s
WHERE s.client_slug IN (
  'alessandro-lima','anthony-sodre','bartira-paes','bernadete',
  'claudia-kellner','cynthia-naranjo','deyse-engel','fabiana-parro',
  'joao-eduardo-zanela','luciano-simionato','matheus-borges','rafael-molino',
  'nairio','osvaldo-catena','pedro-nery','priscila-ziliani',
  'suely-resende','vitor-negrao','willian-loro'
)
ORDER BY s.client_slug, s.service_type;

-- ============================================================================
-- BLOCO 3 — EXECUÇÃO
-- ============================================================================

BEGIN;

-- 3.0) Sanity: garante que portal.hotmart_offers existe e tem as colunas
--      esperadas. Aborta se algo estiver diferente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='portal' AND table_name='hotmart_offers'
  ) THEN
    RAISE EXCEPTION 'ABORTADO: portal.hotmart_offers não existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='portal' AND table_name='hotmart_offers'
      AND column_name='monthly_value'
  ) THEN
    RAISE EXCEPTION 'ABORTADO: portal.hotmart_offers.monthly_value não existe';
  END IF;
END $$;

-- 3.1) UPSERT das 12 ofertas vigentes do CSV.
--      generation: '2025' para nomes com sufixo 2025, 'legacy' para os demais.
INSERT INTO portal.hotmart_offers (offer_code, service_name, monthly_value, generation)
VALUES
  ('bbs6f4qn', 'Gestor de Disparos 2025',  1300.00, '2025'),
  ('n6o84uq5', 'Gestor de Disparos',        800.00, 'legacy'),
  ('ihbplci2', 'Copywriter 2025',          1300.00, '2025'),
  ('g9w7txad', 'Copywriter',                800.00, 'legacy'),
  ('lbjzicmm', 'Design Gráfico',            800.00, 'legacy'),
  ('c07ieg22', 'Edição de Vídeo 2025',     1500.00, '2025'),
  ('hqhbhqhd', 'Edição de Vídeo',          1000.00, 'legacy'),
  ('iaafjy8m', 'Gestão de Redes Sociais',   800.00, 'legacy'),
  ('52pqh4nd', 'Gestão de Tráfego 2025',   1500.00, '2025'),
  ('td9xav44', 'Tráfego',                  1000.00, 'legacy'),
  ('oo578cny', 'Web Design 2025',          1300.00, '2025'),
  ('mrt15ap7', 'Web Designer',              800.00, 'legacy')
ON CONFLICT (offer_code) DO UPDATE SET
  service_name  = EXCLUDED.service_name,
  monthly_value = EXCLUDED.monthly_value,
  generation    = EXCLUDED.generation;

-- 3.2) Mapping (client_slug, service_key) → offer_code do CSV.
CREATE TEMP TABLE _link (
  client_slug  text NOT NULL,
  service_key  text NOT NULL,
  offer_code   text NOT NULL,
  PRIMARY KEY (client_slug, service_key)
) ON COMMIT DROP;

INSERT INTO _link (client_slug, service_key, offer_code) VALUES
  ('alessandro-lima',     'AUTOMACAO',    'bbs6f4qn'),
  ('alessandro-lima',     'TRAFEGO',      '52pqh4nd'),
  ('alessandro-lima',     'WEB_DESIGNER', 'oo578cny'),

  ('anthony-sodre',       'TRAFEGO',      '52pqh4nd'),
  ('anthony-sodre',       'WEB_DESIGNER', 'oo578cny'),

  ('bartira-paes',        'TRAFEGO',      'td9xav44'),

  ('bernadete',           'EDICAO_VIDEO', 'hqhbhqhd'),
  ('bernadete',           'TRAFEGO',      '52pqh4nd'),
  ('bernadete',           'WEB_DESIGNER', 'oo578cny'),

  ('claudia-kellner',     'EDICAO_VIDEO', 'hqhbhqhd'),
  ('claudia-kellner',     'TRAFEGO',      '52pqh4nd'),

  ('cynthia-naranjo',     'TRAFEGO',      '52pqh4nd'),

  ('deyse-engel',         'TRAFEGO',      'td9xav44'),
  ('deyse-engel',         'WEB_DESIGNER', 'mrt15ap7'),

  ('fabiana-parro',       'TRAFEGO',      '52pqh4nd'),

  ('joao-eduardo-zanela', 'COPYWRITER',   'g9w7txad'),
  ('joao-eduardo-zanela', 'DESIGNER',     'lbjzicmm'),
  ('joao-eduardo-zanela', 'EDICAO_VIDEO', 'hqhbhqhd'),
  ('joao-eduardo-zanela', 'AUTOMACAO',    'n6o84uq5'),
  ('joao-eduardo-zanela', 'SOCIAL_MEDIA', 'iaafjy8m'),
  ('joao-eduardo-zanela', 'TRAFEGO',      'td9xav44'),
  ('joao-eduardo-zanela', 'WEB_DESIGNER', 'mrt15ap7'),

  ('luciano-simionato',   'EDICAO_VIDEO', 'hqhbhqhd'),
  ('luciano-simionato',   'WEB_DESIGNER', 'mrt15ap7'),

  ('matheus-borges',      'TRAFEGO',      'td9xav44'),

  ('rafael-molino',       'EDICAO_VIDEO', 'c07ieg22'),
  ('rafael-molino',       'AUTOMACAO',    'bbs6f4qn'),
  ('rafael-molino',       'TRAFEGO',      '52pqh4nd'),
  ('rafael-molino',       'WEB_DESIGNER', 'oo578cny'),

  ('nairio',              'DESIGNER',     'lbjzicmm'),
  ('nairio',              'AUTOMACAO',    'n6o84uq5'),
  ('nairio',              'TRAFEGO',      'td9xav44'),
  ('nairio',              'WEB_DESIGNER', 'mrt15ap7'),

  ('osvaldo-catena',      'AUTOMACAO',    'n6o84uq5'),

  ('pedro-nery',          'COPYWRITER',   'g9w7txad'),
  ('pedro-nery',          'DESIGNER',     'lbjzicmm'),
  ('pedro-nery',          'EDICAO_VIDEO', 'hqhbhqhd'),
  ('pedro-nery',          'SOCIAL_MEDIA', 'iaafjy8m'),

  ('priscila-ziliani',    'DESIGNER',     'lbjzicmm'),
  ('priscila-ziliani',    'EDICAO_VIDEO', 'hqhbhqhd'),
  -- priscila-ziliani / EDICAO_VIDEO: sem venda Hotmart vigente — fica linkado
  -- ao offer hqhbhqhd e marcado como 'delinquent' no passo 3.3b para que apareça
  -- como vencido (e não entre no MRR).

  ('suely-resende',       'EDICAO_VIDEO', 'c07ieg22'),
  ('suely-resende',       'AUTOMACAO',    'bbs6f4qn'),
  ('suely-resende',       'TRAFEGO',      '52pqh4nd'),
  ('suely-resende',       'WEB_DESIGNER', 'oo578cny'),

  ('vitor-negrao',        'COPYWRITER',   'g9w7txad'),
  ('vitor-negrao',        'DESIGNER',     'lbjzicmm'),
  ('vitor-negrao',        'EDICAO_VIDEO', 'hqhbhqhd'),
  ('vitor-negrao',        'AUTOMACAO',    'n6o84uq5'),
  ('vitor-negrao',        'SOCIAL_MEDIA', 'iaafjy8m'),
  ('vitor-negrao',        'WEB_DESIGNER', 'mrt15ap7'),

  ('willian-loro',        'COPYWRITER',   'ihbplci2'),
  ('willian-loro',        'AUTOMACAO',    'bbs6f4qn'),
  ('willian-loro',        'TRAFEGO',      'td9xav44'),
  ('willian-loro',        'WEB_DESIGNER', 'mrt15ap7');

-- 3.3) Atualiza portal.services.offer_code casando por (client_slug, service_key
--      normalizado). Usa a mesma regra de normalização da 015/020.
--      O trigger trg_services_recalc_subscription dispara em cada UPDATE e
--      recalcula portal.subscriptions automaticamente.
WITH normalized AS (
  SELECT
    s.id,
    s.client_slug,
    CASE
      WHEN upper(s.service_type) = 'HOST' OR upper(s.service_type) LIKE '%HOSPED%' THEN 'HOSPEDAGEM'
      WHEN upper(s.service_type) LIKE '%WEB DESIGN%' OR upper(s.service_type) IN ('WEBDESIGNER','WEB DESIGNER') THEN 'WEB_DESIGNER'
      WHEN upper(s.service_type) LIKE '%TRÁFEGO%' OR upper(s.service_type) LIKE '%TRAFEGO%' OR upper(s.service_type) IN ('ANÚNCIOS PAGOS','ANUNCIOS PAGOS') THEN 'TRAFEGO'
      WHEN upper(s.service_type) LIKE '%EDIÇÃO DE VÍDEO%' OR upper(s.service_type) LIKE '%EDICAO DE VIDEO%' OR upper(s.service_type) LIKE '%EDIÇÃO DE VIDEO%' THEN 'EDICAO_VIDEO'
      WHEN upper(s.service_type) LIKE '%REDES SOCIAIS%' OR upper(s.service_type) = 'SOCIAL MEDIA' THEN 'SOCIAL_MEDIA'
      WHEN upper(s.service_type) LIKE '%DISPAROS%' OR upper(s.service_type) IN ('AUTOMAÇÃO','AUTOMACAO') THEN 'AUTOMACAO'
      WHEN upper(s.service_type) LIKE '%DESIGN GRÁFICO%' OR upper(s.service_type) LIKE '%DESIGN GRAFICO%' OR upper(s.service_type) = 'DESIGNER' THEN 'DESIGNER'
      WHEN upper(s.service_type) LIKE '%COPYWRITER%' OR upper(s.service_type) = 'COPY' THEN 'COPYWRITER'
      ELSE upper(s.service_type)
    END AS service_key
  FROM portal.services s
  WHERE s.client_slug IN (SELECT DISTINCT client_slug FROM _link)
)
UPDATE portal.services s
   SET offer_code = l.offer_code,
       metadata   = COALESCE(s.metadata, '{}'::jsonb) || jsonb_build_object(
         'offer_code_relinked_at',     '2026-05-14',
         'offer_code_relinked_source', 'sales_history_20260514'
       ),
       updated_at = now()
  FROM normalized n
  JOIN _link l
    ON l.client_slug = n.client_slug
   AND l.service_key = n.service_key
 WHERE s.id = n.id;

-- 3.3b) Marca priscila-ziliani / EDICAO_VIDEO como vencido (delinquent),
--       com access_until 1 dia no passado, para que o webhook reativar quando
--       a venda real chegar (a renovação vai puxar access_until = hoje+30
--       conforme a regra de dias_restantes+30).
UPDATE portal.services s
   SET status        = 'delinquent',
       access_until  = (CURRENT_DATE - 1),
       metadata      = COALESCE(s.metadata, '{}'::jsonb) || jsonb_build_object(
         'priscila_edicao_video_no_hotmart_sale', true,
         'forced_delinquent_at', '2026-05-14'
       ),
       updated_at    = now()
 WHERE s.client_slug = 'priscila-ziliani'
   AND upper(s.service_type) LIKE '%EDIÇÃO DE VÍDEO%';

-- 3.4) Verificação final
SELECT
  (SELECT count(*) FROM portal.hotmart_offers WHERE offer_code IN (
     'bbs6f4qn','n6o84uq5','ihbplci2','g9w7txad','lbjzicmm','c07ieg22',
     'hqhbhqhd','iaafjy8m','52pqh4nd','td9xav44','oo578cny','mrt15ap7'))         AS offers_present,
  (SELECT count(*) FROM portal.services
    WHERE client_slug IN (SELECT DISTINCT client_slug FROM _link)
      AND offer_code IS NOT NULL AND offer_code <> '')                            AS services_with_offer_code,
  (SELECT count(*) FROM portal.services
    WHERE client_slug IN (SELECT DISTINCT client_slug FROM _link)
      AND (offer_code IS NULL OR offer_code = ''))                                AS services_without_offer_code,
  (SELECT round(SUM(o.monthly_value)::numeric, 2)
     FROM portal.services s
     JOIN portal.hotmart_offers o ON o.offer_code = s.offer_code
    WHERE s.client_slug IN (SELECT DISTINCT client_slug FROM _link)
      AND s.status = 'active')                                                    AS total_mrr_truth_clients;

-- Esperado:
--   offers_present              = 12
--   services_with_offer_code    = 54   (todos os da TSV)
--   services_without_offer_code = 0
--   total_mrr_truth_clients     = R$ 56.800,00 (soma das mensalidades dos 53
--                                  serviços com status='active'. priscila/
--                                  EDICAO_VIDEO está delinquent e fica fora.)
--
-- Se tudo bater: COMMIT;
-- Se algo está errado: ROLLBACK;

-- 3.5) Bônus — auditoria do MRR por cliente
SELECT
  s.client_slug,
  count(*) FILTER (WHERE s.offer_code IS NOT NULL)         AS linked_services,
  count(*) FILTER (WHERE s.offer_code IS NULL)             AS unlinked_services,
  COALESCE(SUM(o.monthly_value), 0)                        AS mrr,
  sub.monthly_value                                        AS subscription_mrr
FROM portal.services s
LEFT JOIN portal.hotmart_offers o ON o.offer_code = s.offer_code
LEFT JOIN portal.subscriptions  sub ON sub.client_slug = s.client_slug
WHERE s.client_slug IN (SELECT DISTINCT client_slug FROM _link)
  AND s.status = 'active'
GROUP BY s.client_slug, sub.monthly_value
ORDER BY s.client_slug;

-- COMMIT;   -- <— descomente para confirmar
-- ROLLBACK; -- <— ou descomente este para abortar

-- ============================================================================
-- Fim 021_link_services_to_hotmart_offers.sql
-- ============================================================================
