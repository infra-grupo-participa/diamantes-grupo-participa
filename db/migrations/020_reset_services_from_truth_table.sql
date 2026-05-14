-- ============================================================================
-- 020_reset_services_from_truth_table.sql
-- Reset completo dos serviços ativos a partir da tabela verdade de 2026-05-14
-- (C:\Users\infra\Downloads\table.tsv — 19 clientes).
--
-- Comportamento:
--   1. Preserva o access_until atual de cada par (client_slug, service_key)
--      antes de tocar em qualquer coisa (snapshot em TEMP TABLE).
--   2. Apaga TODOS os serviços dos 19 clientes da tabela verdade.
--      (Os serviços de outros clientes ficam inalterados — limpeza geral é
--       responsabilidade da migration 019.)
--   3. Reinsere apenas os serviços da tabela verdade, restaurando o
--      access_until pelo snapshot quando havia correspondência.
--
-- ESTE SCRIPT É TRANSACIONAL. Rode dentro de BEGIN/COMMIT no SQL Editor.
-- BLOCO 1 e 2 são pré-flight (SELECT). BLOCO 3 executa o reset.
-- ============================================================================

-- ============================================================================
-- BLOCO 1 — PRÉ-FLIGHT: estado atual dos serviços dos 19 clientes
-- ============================================================================

WITH truth_slugs AS (
  SELECT unnest(ARRAY[
    'alessandro-lima','anthony-sodre','bartira-paes','bernadete',
    'claudia-kellner','cynthia-naranjo','deyse-engel','fabiana-parro',
    'joao-eduardo-zanela','luciano-simionato','matheus-borges','rafael-molino',
    'nairio','osvaldo-catena','pedro-nery','priscila-ziliani',
    'suely-resende','vitor-negrao','willian-loro'
  ]) AS slug
)
SELECT
  s.client_slug,
  s.service_type,
  s.status,
  s.offer_code,
  s.access_until,
  (s.access_until - CURRENT_DATE) AS days_left,
  s.created_at
FROM portal.services s
WHERE s.client_slug IN (SELECT slug FROM truth_slugs)
ORDER BY s.client_slug, s.service_type;

-- ============================================================================
-- BLOCO 2 — PRÉ-FLIGHT: confirma slug da Cynthia
-- ============================================================================

SELECT slug, display_name
FROM portal.clients
WHERE lower(display_name) LIKE '%cynthia%'
   OR lower(display_name) LIKE '%naranjo%';

-- Se o slug retornado for diferente de 'cynthia-naranjo', edite o array
-- truth_slugs do BLOCO 3 e a CTE desired antes de rodar.

-- ============================================================================
-- BLOCO 3 — EXECUÇÃO: reset dos serviços ativos
-- ============================================================================

BEGIN;

-- 3.0) Lista de clientes da verdade (mesmo array do BLOCO 1)
CREATE TEMP TABLE _truth_slugs (slug text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _truth_slugs VALUES
  ('alessandro-lima'),('anthony-sodre'),('bartira-paes'),('bernadete'),
  ('claudia-kellner'),('cynthia-naranjo'),('deyse-engel'),('fabiana-parro'),
  ('joao-eduardo-zanela'),('luciano-simionato'),('matheus-borges'),('rafael-molino'),
  ('nairio'),('osvaldo-catena'),('pedro-nery'),('priscila-ziliani'),
  ('suely-resende'),('vitor-negrao'),('willian-loro');

-- 3.1) Sanity: aborta se algum slug da verdade não existir em portal.clients
DO $$
DECLARE
  missing_list text;
BEGIN
  SELECT string_agg(t.slug, ', ')
    INTO missing_list
  FROM _truth_slugs t
  LEFT JOIN portal.clients c ON c.slug = t.slug
  WHERE c.slug IS NULL;
  IF missing_list IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTADO: slugs da verdade não existem em portal.clients: %', missing_list;
  END IF;
END $$;

-- 3.2) Tabela verdade (cliente × setor × nome do serviço)
CREATE TEMP TABLE _desired (
  client_slug  text NOT NULL,
  service_key  text NOT NULL,
  service_type text NOT NULL,
  PRIMARY KEY (client_slug, service_key)
) ON COMMIT DROP;

INSERT INTO _desired (client_slug, service_key, service_type) VALUES
  ('alessandro-lima',     'AUTOMACAO',    'GESTOR DE DISPAROS 2025'),
  ('alessandro-lima',     'TRAFEGO',      'GESTÃO DE TRÁFEGO 2025'),
  ('alessandro-lima',     'WEB_DESIGNER', 'WEB DESIGN 2025'),

  ('anthony-sodre',       'TRAFEGO',      'GESTÃO DE TRÁFEGO 2025'),
  ('anthony-sodre',       'WEB_DESIGNER', 'WEB DESIGN 2025'),

  ('bartira-paes',        'TRAFEGO',      'TRÁFEGO'),

  ('bernadete',           'EDICAO_VIDEO', 'EDIÇÃO DE VÍDEO'),
  ('bernadete',           'TRAFEGO',      'GESTÃO DE TRÁFEGO 2025'),
  ('bernadete',           'WEB_DESIGNER', 'WEB DESIGN 2025'),

  ('claudia-kellner',     'EDICAO_VIDEO', 'EDIÇÃO DE VÍDEO'),
  ('claudia-kellner',     'TRAFEGO',      'GESTÃO DE TRÁFEGO 2025'),

  ('cynthia-naranjo',     'TRAFEGO',      'GESTÃO DE TRÁFEGO 2025'),

  ('deyse-engel',         'TRAFEGO',      'TRÁFEGO'),
  ('deyse-engel',         'WEB_DESIGNER', 'WEB DESIGNER'),

  ('fabiana-parro',       'TRAFEGO',      'GESTÃO DE TRÁFEGO 2025'),

  ('joao-eduardo-zanela', 'COPYWRITER',   'COPYWRITER'),
  ('joao-eduardo-zanela', 'DESIGNER',     'DESIGN GRÁFICO'),
  ('joao-eduardo-zanela', 'EDICAO_VIDEO', 'EDIÇÃO DE VÍDEO'),
  ('joao-eduardo-zanela', 'AUTOMACAO',    'GESTOR DE DISPAROS'),
  ('joao-eduardo-zanela', 'SOCIAL_MEDIA', 'GESTÃO DE REDES SOCIAIS'),
  ('joao-eduardo-zanela', 'TRAFEGO',      'TRÁFEGO'),
  ('joao-eduardo-zanela', 'WEB_DESIGNER', 'WEB DESIGNER'),

  ('luciano-simionato',   'EDICAO_VIDEO', 'EDIÇÃO DE VÍDEO'),
  ('luciano-simionato',   'WEB_DESIGNER', 'WEB DESIGNER'),

  ('matheus-borges',      'TRAFEGO',      'TRÁFEGO'),

  ('rafael-molino',       'EDICAO_VIDEO', 'EDIÇÃO DE VÍDEO 2025'),
  ('rafael-molino',       'AUTOMACAO',    'GESTOR DE DISPAROS 2025'),
  ('rafael-molino',       'TRAFEGO',      'GESTÃO DE TRÁFEGO 2025'),
  ('rafael-molino',       'WEB_DESIGNER', 'WEB DESIGN 2025'),

  ('nairio',              'DESIGNER',     'DESIGN GRÁFICO'),
  ('nairio',              'AUTOMACAO',    'GESTOR DE DISPAROS'),
  ('nairio',              'TRAFEGO',      'TRÁFEGO'),
  ('nairio',              'WEB_DESIGNER', 'WEB DESIGNER'),

  ('osvaldo-catena',      'AUTOMACAO',    'GESTOR DE DISPAROS'),

  ('pedro-nery',          'COPYWRITER',   'COPYWRITER'),
  ('pedro-nery',          'DESIGNER',     'DESIGN GRÁFICO'),
  ('pedro-nery',          'EDICAO_VIDEO', 'EDIÇÃO DE VÍDEO'),
  ('pedro-nery',          'SOCIAL_MEDIA', 'GESTÃO DE REDES SOCIAIS'),

  ('priscila-ziliani',    'DESIGNER',     'DESIGN GRÁFICO'),
  ('priscila-ziliani',    'EDICAO_VIDEO', 'EDIÇÃO DE VÍDEO'),

  ('suely-resende',       'EDICAO_VIDEO', 'EDIÇÃO DE VÍDEO 2025'),
  ('suely-resende',       'AUTOMACAO',    'GESTOR DE DISPAROS 2025'),
  ('suely-resende',       'TRAFEGO',      'GESTÃO DE TRÁFEGO 2025'),
  ('suely-resende',       'WEB_DESIGNER', 'WEB DESIGN 2025'),

  ('vitor-negrao',        'COPYWRITER',   'COPYWRITER'),
  ('vitor-negrao',        'DESIGNER',     'DESIGN GRÁFICO'),
  ('vitor-negrao',        'EDICAO_VIDEO', 'EDIÇÃO DE VÍDEO'),
  ('vitor-negrao',        'AUTOMACAO',    'GESTOR DE DISPAROS'),
  ('vitor-negrao',        'SOCIAL_MEDIA', 'GESTÃO DE REDES SOCIAIS'),
  ('vitor-negrao',        'WEB_DESIGNER', 'WEB DESIGNER'),

  ('willian-loro',        'COPYWRITER',   'COPYWRITER 2025'),
  ('willian-loro',        'AUTOMACAO',    'GESTOR DE DISPAROS 2025'),
  ('willian-loro',        'TRAFEGO',      'TRÁFEGO'),
  ('willian-loro',        'WEB_DESIGNER', 'WEB DESIGNER');

-- 3.3) Snapshot do access_until por (client_slug, service_key normalizado).
--      Pega o maior access_until quando há duplicatas no mesmo setor.
CREATE TEMP TABLE _access_snapshot (
  client_slug  text NOT NULL,
  service_key  text NOT NULL,
  access_until date,
  offer_code   text,
  PRIMARY KEY (client_slug, service_key)
) ON COMMIT DROP;

INSERT INTO _access_snapshot (client_slug, service_key, access_until, offer_code)
SELECT
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
  END AS service_key,
  max(s.access_until) AS access_until,
  -- pega um offer_code não-nulo qualquer (se houver) para preservar a linha hotmart
  (array_agg(s.offer_code) FILTER (WHERE s.offer_code IS NOT NULL AND s.offer_code <> ''))[1] AS offer_code
FROM portal.services s
WHERE s.client_slug IN (SELECT slug FROM _truth_slugs)
GROUP BY 1, 2;

-- 3.4) Mostra o snapshot capturado (linha por cliente × setor preservado).
--      Esse SELECT serve só de auditoria — o resultado aparece no log do SQL Editor.
SELECT 'access_until_snapshot' AS step,
       client_slug, service_key, access_until, offer_code
FROM _access_snapshot
ORDER BY client_slug, service_key;

-- 3.5) Apaga TODOS os serviços dos 19 clientes da verdade.
--      (portal.services não tem FKs descendentes além de metadata jsonb, então
--       o DELETE é seguro. team_assignments referencia client_slug, não service_id.)
DELETE FROM portal.services
WHERE client_slug IN (SELECT slug FROM _truth_slugs);

-- 3.6) Reinsere os serviços da tabela verdade, restaurando access_until/offer_code
--      pelo snapshot quando o par (client_slug, service_key) existia antes.
INSERT INTO portal.services (
  client_slug,
  service_type,
  status,
  offer_code,
  access_until,
  metadata
)
SELECT
  d.client_slug,
  d.service_type,
  'active',
  snap.offer_code,
  snap.access_until,
  jsonb_build_object(
    'source',           'truth_table_reset',
    'synced_at',        '2026-05-14',
    'synced_from',      'C:\\Users\\infra\\Downloads\\table.tsv',
    'access_preserved', (snap.access_until IS NOT NULL)
  )
FROM _desired d
LEFT JOIN _access_snapshot snap
  ON snap.client_slug = d.client_slug
 AND snap.service_key = d.service_key;

-- 3.7) Verificação final
SELECT
  (SELECT count(*) FROM portal.services WHERE client_slug IN (SELECT slug FROM _truth_slugs))                                                    AS total_services_truth_clients,
  (SELECT count(*) FROM portal.services WHERE client_slug IN (SELECT slug FROM _truth_slugs) AND status = 'active')                              AS active_services,
  (SELECT count(*) FROM portal.services WHERE client_slug IN (SELECT slug FROM _truth_slugs) AND access_until IS NOT NULL)                       AS services_with_access_until,
  (SELECT count(*) FROM portal.services WHERE client_slug IN (SELECT slug FROM _truth_slugs) AND offer_code IS NOT NULL AND offer_code <> '')    AS services_with_offer_code;

-- Esperado:
--   total_services_truth_clients  = 54  (3+2+1+3+2+1+2+1+7+2+1+4+4+1+4+2+4+6+4)
--   active_services               = 54
--   services_with_access_until    = depende do snapshot — quantos pares casaram
--   services_with_offer_code      = depende do snapshot
--
-- Se tudo bater: COMMIT;
-- Se algo está errado: ROLLBACK;

-- COMMIT;   -- <— descomente para confirmar
-- ROLLBACK; -- <— ou descomente este para abortar

-- ============================================================================
-- Fim 020_reset_services_from_truth_table.sql
-- ============================================================================
