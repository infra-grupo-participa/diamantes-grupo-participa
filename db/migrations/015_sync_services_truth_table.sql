-- ============================================================================
-- 015_sync_services_truth_table.sql
-- Sincroniza os serviços ativos com a tabela verdade recebida em 2026-05-12.
-- Objetivos:
--   1. remover duplicidades por setor (ex.: Web Designer + HOST legado)
--   2. cancelar serviços ativos fora da tabela verdade
--   3. inserir serviços faltantes como contratos manuais quando necessário
-- ============================================================================

WITH desired AS (
  SELECT *
  FROM (
    VALUES
      ('alessandro-lima',      'AUTOMACAO',      'GESTOR DE DISPAROS 2025'),
      ('alessandro-lima',      'TRAFEGO',        'GESTÃO DE TRÁFEGO 2025'),
      ('alessandro-lima',      'WEB_DESIGNER',   'WEB DESIGN 2025'),

      ('anthony-sodre',        'TRAFEGO',        'GESTÃO DE TRÁFEGO 2025'),
      ('anthony-sodre',        'WEB_DESIGNER',   'WEB DESIGN 2025'),

      ('bartira-paes',         'TRAFEGO',        'TRÁFEGO'),

      ('bernadete',            'EDICAO_VIDEO',   'EDIÇÃO DE VÍDEO'),
      ('bernadete',            'TRAFEGO',        'GESTÃO DE TRÁFEGO 2025'),
      ('bernadete',            'WEB_DESIGNER',   'WEB DESIGN 2025'),

      ('claudia-kellner',      'EDICAO_VIDEO',   'EDIÇÃO DE VÍDEO'),
      ('claudia-kellner',      'TRAFEGO',        'GESTÃO DE TRÁFEGO 2025'),

      ('deyse-engel',          'TRAFEGO',        'TRÁFEGO'),
      ('deyse-engel',          'WEB_DESIGNER',   'WEB DESIGNER'),

      ('fabiana-parro',        'TRAFEGO',        'GESTÃO DE TRÁFEGO 2025'),

      ('joao-eduardo-zanela',  'AUTOMACAO',      'GESTOR DE DISPAROS'),
      ('joao-eduardo-zanela',  'COPYWRITER',     'COPYWRITER'),
      ('joao-eduardo-zanela',  'DESIGNER',       'DESIGN GRÁFICO'),
      ('joao-eduardo-zanela',  'EDICAO_VIDEO',   'EDIÇÃO DE VÍDEO'),
      ('joao-eduardo-zanela',  'SOCIAL_MEDIA',   'GESTÃO DE REDES SOCIAIS'),
      ('joao-eduardo-zanela',  'TRAFEGO',        'TRÁFEGO'),
      ('joao-eduardo-zanela',  'WEB_DESIGNER',   'WEB DESIGNER'),

      ('luciano-simionato',    'EDICAO_VIDEO',   'EDIÇÃO DE VÍDEO'),
      ('luciano-simionato',    'WEB_DESIGNER',   'WEB DESIGNER'),

      ('matheus-borges',       'TRAFEGO',        'TRÁFEGO'),

      ('nairio',               'AUTOMACAO',      'GESTOR DE DISPAROS'),
      ('nairio',               'DESIGNER',       'DESIGN GRÁFICO'),
      ('nairio',               'TRAFEGO',        'TRÁFEGO'),
      ('nairio',               'WEB_DESIGNER',   'WEB DESIGNER'),

      ('osvaldo-catena',       'AUTOMACAO',      'GESTOR DE DISPAROS'),

      ('pedro-nery',           'COPYWRITER',     'COPYWRITER'),
      ('pedro-nery',           'DESIGNER',       'DESIGN GRÁFICO'),
      ('pedro-nery',           'EDICAO_VIDEO',   'EDIÇÃO DE VÍDEO'),
      ('pedro-nery',           'SOCIAL_MEDIA',   'GESTÃO DE REDES SOCIAIS'),

      ('priscila-ziliani',     'DESIGNER',       'DESIGN GRÁFICO'),
      ('priscila-ziliani',     'EDICAO_VIDEO',   'EDIÇÃO DE VÍDEO'),

      ('rafael-molino',        'AUTOMACAO',      'GESTOR DE DISPAROS 2025'),
      ('rafael-molino',        'EDICAO_VIDEO',   'EDIÇÃO DE VÍDEO 2025'),
      ('rafael-molino',        'TRAFEGO',        'GESTÃO DE TRÁFEGO 2025'),
      ('rafael-molino',        'WEB_DESIGNER',   'WEB DESIGN 2025'),

      ('suely-resende',        'AUTOMACAO',      'GESTOR DE DISPAROS 2025'),
      ('suely-resende',        'EDICAO_VIDEO',   'EDIÇÃO DE VÍDEO 2025'),
      ('suely-resende',        'TRAFEGO',        'GESTÃO DE TRÁFEGO 2025'),
      ('suely-resende',        'WEB_DESIGNER',   'WEB DESIGN 2025'),

      ('vitor-negrao',         'AUTOMACAO',      'GESTOR DE DISPAROS'),
      ('vitor-negrao',         'COPYWRITER',     'COPYWRITER'),
      ('vitor-negrao',         'DESIGNER',       'DESIGN GRÁFICO'),
      ('vitor-negrao',         'EDICAO_VIDEO',   'EDIÇÃO DE VÍDEO'),
      ('vitor-negrao',         'SOCIAL_MEDIA',   'GESTÃO DE REDES SOCIAIS'),
      ('vitor-negrao',         'WEB_DESIGNER',   'WEB DESIGNER'),

      ('willian-loro',         'AUTOMACAO',      'GESTOR DE DISPAROS 2025'),
      ('willian-loro',         'COPYWRITER',     'COPYWRITER 2025'),
      ('willian-loro',         'TRAFEGO',        'TRÁFEGO'),
      ('willian-loro',         'WEB_DESIGNER',   'WEB DESIGNER')
  ) AS t(client_slug, service_key, service_type)
),
target_clients AS (
  SELECT DISTINCT client_slug
  FROM desired
),
existing AS (
  SELECT
    s.id,
    s.client_slug,
    s.status,
    s.offer_code,
    s.created_at,
    CASE
      WHEN upper(s.service_type) = 'HOST' OR upper(s.service_type) LIKE '%HOSPED%' THEN 'HOSPEDAGEM'
      WHEN upper(s.service_type) LIKE '%WEB DESIGN%' OR upper(s.service_type) IN ('WEBDESIGNER', 'WEB DESIGNER') THEN 'WEB_DESIGNER'
      WHEN upper(s.service_type) LIKE '%TRÁFEGO%' OR upper(s.service_type) LIKE '%TRAFEGO%' OR upper(s.service_type) IN ('ANÚNCIOS PAGOS', 'ANUNCIOS PAGOS') THEN 'TRAFEGO'
      WHEN upper(s.service_type) LIKE '%EDIÇÃO DE VÍDEO%' OR upper(s.service_type) LIKE '%EDICAO DE VIDEO%' OR upper(s.service_type) LIKE '%EDIÇÃO DE VIDEO%' THEN 'EDICAO_VIDEO'
      WHEN upper(s.service_type) LIKE '%REDES SOCIAIS%' OR upper(s.service_type) = 'SOCIAL MEDIA' THEN 'SOCIAL_MEDIA'
      WHEN upper(s.service_type) LIKE '%DISPAROS%' OR upper(s.service_type) IN ('AUTOMAÇÃO', 'AUTOMACAO') THEN 'AUTOMACAO'
      WHEN upper(s.service_type) LIKE '%DESIGN GRÁFICO%' OR upper(s.service_type) LIKE '%DESIGN GRAFICO%' OR upper(s.service_type) = 'DESIGNER' THEN 'DESIGNER'
      WHEN upper(s.service_type) LIKE '%COPYWRITER%' OR upper(s.service_type) = 'COPY' THEN 'COPYWRITER'
      ELSE upper(s.service_type)
    END AS service_key
  FROM portal.services s
  JOIN target_clients tc
    ON tc.client_slug = s.client_slug
),
ranked AS (
  SELECT
    e.*,
    row_number() OVER (
      PARTITION BY e.client_slug, e.service_key
      ORDER BY
        CASE WHEN e.offer_code IS NOT NULL AND e.offer_code <> '' THEN 0 ELSE 1 END,
        CASE WHEN e.status = 'active' THEN 0 WHEN e.status = 'delinquent' THEN 1 ELSE 2 END,
        e.created_at DESC,
        e.id DESC
    ) AS rn
  FROM existing e
),
to_keep AS (
  SELECT r.id, r.client_slug, r.service_key, d.service_type
  FROM ranked r
  JOIN desired d
    ON d.client_slug = r.client_slug
   AND d.service_key = r.service_key
  WHERE r.rn = 1
),
missing AS (
  SELECT d.client_slug, d.service_key, d.service_type
  FROM desired d
  LEFT JOIN to_keep k
    ON k.client_slug = d.client_slug
   AND k.service_key = d.service_key
  WHERE k.id IS NULL
),
cancel_extras AS (
  UPDATE portal.services s
     SET status = 'canceled',
         canceled_at = COALESCE(s.canceled_at, now()),
         updated_at = now(),
         metadata = COALESCE(s.metadata, '{}'::jsonb) || jsonb_build_object(
           'truth_table_sync', '2026-05-12',
           'truth_table_source', 'C:\\Users\\infra\\Downloads\\table.tsv'
         )
    FROM ranked r
   WHERE s.id = r.id
     AND s.status IN ('active', 'delinquent')
     AND (
       r.rn > 1
       OR NOT EXISTS (
         SELECT 1
         FROM desired d
         WHERE d.client_slug = r.client_slug
           AND d.service_key = r.service_key
       )
     )
  RETURNING s.id
),
normalize_kept AS (
  UPDATE portal.services s
     SET service_type = k.service_type,
         status = 'active',
         canceled_at = NULL,
         updated_at = now(),
         metadata = COALESCE(s.metadata, '{}'::jsonb) || jsonb_build_object(
           'truth_table_sync', '2026-05-12',
           'truth_table_source', 'C:\\Users\\infra\\Downloads\\table.tsv'
         )
    FROM to_keep k
   WHERE s.id = k.id
  RETURNING s.id
)
INSERT INTO portal.services (
  client_slug,
  service_type,
  status,
  offer_code,
  access_until,
  metadata
)
SELECT
  m.client_slug,
  m.service_type,
  'active',
  NULL,
  NULL,
  jsonb_build_object(
    'source', 'truth_table_sync',
    'synced_at', '2026-05-12',
    'synced_from', 'C:\\Users\\infra\\Downloads\\table.tsv'
  )
FROM missing m;

-- Observação:
-- "Cynthia Ribeiro Naranjo" aparece na tabela verdade, mas não foi localizada
-- nas fontes versionadas deste repositório. O vínculo deve ser resolvido no
-- banco remoto antes de incluir essa cliente em uma migration idempotente.

-- ============================================================================
-- Fim 015_sync_services_truth_table.sql
-- ============================================================================
