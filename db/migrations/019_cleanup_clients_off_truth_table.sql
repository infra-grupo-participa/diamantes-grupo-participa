-- ============================================================================
-- 019_cleanup_clients_off_truth_table.sql
-- Apaga clientes que NÃO constam na tabela verdade de 2026-05-14
-- (C:\Users\infra\Downloads\table.tsv — 19 clientes ativos).
--
-- Também cria 1 cliente de teste E2E para validação.
--
-- ESTA MIGRATION FOI APLICADA EM PROD VIA MCP em 2026-05-14. As decisões
-- de schema e FKs abaixo refletem o estado REAL do banco (algumas
-- divergem do que a 016/anterior aparenta documentar):
--   - clientes têm role='user' em portal.users (NÃO 'client' — constraint
--     users_role_check só permite 'user','admin','operator')
--   - portal.users tem coluna 'name' (NÃO 'display_name')
--   - portal.clients.cliente_name_var é NOT NULL sem default
--   - portal.hotmart_purchases.client_slug FK NO ACTION → precisa apagar
--     antes do DELETE em portal.clients
--   - portal.demand_status_log.by_user_id FK NO ACTION → precisa SET NULL
--     antes do DELETE em portal.users
--
-- ESTE SCRIPT É TRANSACIONAL. Rode bloco a bloco no Supabase SQL Editor.
-- Os blocos 1 e 2 são SELECTs (pré-flight). O bloco 3 é o DELETE/INSERT real.
-- ============================================================================

-- ============================================================================
-- BLOCO 1 — PRÉ-FLIGHT: Mostra clientes que SERÃO apagados.
-- Rode isso primeiro e VALIDE a lista antes de seguir.
-- ============================================================================

WITH truth AS (
  SELECT unnest(ARRAY[
    'alessandro-lima',
    'anthony-sodre',
    'bartira-paes',
    'bernadete',
    'claudia-kellner',
    'cynthia-naranjo',
    'deyse-engel',
    'fabiana-parro',
    'joao-eduardo-zanela',
    'luciano-simionato',
    'matheus-borges',
    'rafael-molino',      -- MOLINO E RUA
    'nairio',
    'osvaldo-catena',
    'pedro-nery',
    'priscila-ziliani',
    'suely-resende',
    'vitor-negrao',
    'willian-loro',
    'cliente-teste-e2e'   -- preservar o de teste que será criado no bloco 3
  ]) AS slug
)
SELECT
  c.slug,
  c.display_name,
  (SELECT count(*) FROM portal.services         s WHERE s.client_slug = c.slug) AS svc_count,
  (SELECT count(*) FROM portal.demands          d WHERE d.client_slug = c.slug) AS demands_count,
  (SELECT count(*) FROM portal.team_assignments ta WHERE ta.client_slug = c.slug) AS assignments_count,
  (SELECT count(*) FROM portal.subscriptions    sub WHERE sub.client_slug = c.slug) AS subs_count,
  (SELECT count(*) FROM portal.users            u WHERE u.client_slug = c.slug) AS users_count,
  CASE
    WHEN c.slug IN (SELECT slug FROM truth) THEN 'KEEP'
    ELSE 'DELETE'
  END AS action
FROM portal.clients c
ORDER BY action DESC, c.slug;

-- ============================================================================
-- BLOCO 2 — PRÉ-FLIGHT: confirma slug da Cynthia
-- ============================================================================

SELECT slug, display_name
FROM portal.clients
WHERE lower(display_name) LIKE '%cynthia%'
   OR lower(display_name) LIKE '%naranjo%';

-- Se o slug for diferente de 'cynthia-naranjo', edite o array `_truth_slugs`
-- do BLOCO 3 antes de rodá-lo.

-- ============================================================================
-- BLOCO 3 — EXECUÇÃO: delete cascateado + cliente de teste
-- ============================================================================

BEGIN;

-- 3.1) Alvo (clientes da verdade + teste E2E)
CREATE TEMP TABLE _truth_slugs (slug text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _truth_slugs VALUES
  ('alessandro-lima'),('anthony-sodre'),('bartira-paes'),('bernadete'),
  ('claudia-kellner'),('cynthia-naranjo'),('deyse-engel'),('fabiana-parro'),
  ('joao-eduardo-zanela'),('luciano-simionato'),('matheus-borges'),('rafael-molino'),
  ('nairio'),('osvaldo-catena'),('pedro-nery'),('priscila-ziliani'),
  ('suely-resende'),('vitor-negrao'),('willian-loro'),
  ('cliente-teste-e2e');

-- 3.2) Sanity: aborta se algum slug da verdade não existir em portal.clients
--      (cliente-teste-e2e é exceção — ainda não existe e será criado depois)
DO $$
DECLARE missing_list text;
BEGIN
  SELECT string_agg(t.slug, ', ')
    INTO missing_list
  FROM _truth_slugs t
  LEFT JOIN portal.clients c ON c.slug = t.slug
  WHERE c.slug IS NULL
    AND t.slug <> 'cliente-teste-e2e';
  IF missing_list IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTADO: slugs da verdade não existem em portal.clients: %', missing_list;
  END IF;
END $$;

-- 3.3) Snapshot dos user_ids que serão deletados (clientes fora da verdade)
--      Precisamos coletar os IDs ANTES de qualquer DELETE para conseguir
--      anular as referências em demand_status_log.by_user_id (FK NO ACTION).
CREATE TEMP TABLE _users_to_delete ON COMMIT DROP AS
SELECT pu.id, pu.auth_user_id
FROM portal.users pu
LEFT JOIN portal.clients c ON c.slug = pu.client_slug
WHERE pu.role = 'user'
  AND pu.client_slug IS NOT NULL
  AND (c.slug IS NULL OR c.slug NOT IN (SELECT slug FROM _truth_slugs));

-- 3.4) hotmart_purchases tem FK client_slug → clients com DELETE rule
--      NO ACTION. Precisa apagar ANTES do DELETE em portal.clients.
DELETE FROM portal.hotmart_purchases
WHERE client_slug NOT IN (SELECT slug FROM _truth_slugs);

-- 3.5) demand_status_log.by_user_id tem FK NO ACTION para portal.users.
--      Anula a referência (preserva log histórico de transições de demandas).
UPDATE portal.demand_status_log
   SET by_user_id = NULL
 WHERE by_user_id IN (SELECT id FROM _users_to_delete);

-- 3.6) Demandas (CASCADE → messages, attachments, members, operators,
--      ratings, status_log, operator_points)
DELETE FROM portal.demands
WHERE client_slug NOT IN (SELECT slug FROM _truth_slugs);

-- 3.7) team_assignments, subscriptions, services (CASCADE de clients,
--      mas explícito para deixar logs e contagem claras)
DELETE FROM portal.team_assignments
WHERE client_slug NOT IN (SELECT slug FROM _truth_slugs);

DELETE FROM portal.subscriptions
WHERE client_slug NOT IN (SELECT slug FROM _truth_slugs);

DELETE FROM portal.services
WHERE client_slug NOT IN (SELECT slug FROM _truth_slugs);

-- 3.8) auth.users (Supabase Auth não cascateia automaticamente)
DELETE FROM auth.users
WHERE id IN (SELECT auth_user_id FROM _users_to_delete WHERE auth_user_id IS NOT NULL);

-- 3.9) portal.users (clientes fora da verdade)
DELETE FROM portal.users
WHERE id IN (SELECT id FROM _users_to_delete);

-- 3.10) clientes (cascateia client_profiles, contract_status, ratings,
--       operator_to_client_ratings)
DELETE FROM portal.clients
WHERE slug NOT IN (SELECT slug FROM _truth_slugs);

-- 3.11) Cria cliente-teste-e2e (idempotente)
--       cliente_name_var é NOT NULL sem default → tem que passar valor.
INSERT INTO portal.clients (slug, display_name, cliente_name_var)
VALUES ('cliente-teste-e2e', 'Cliente Teste E2E', 'Cliente Teste E2E')
ON CONFLICT (slug) DO UPDATE SET
  display_name     = EXCLUDED.display_name,
  cliente_name_var = COALESCE(portal.clients.cliente_name_var, EXCLUDED.cliente_name_var);

-- 3.12) Cria 1 serviço ativo pro cliente de teste
INSERT INTO portal.services (client_slug, service_type, status, metadata)
SELECT 'cliente-teste-e2e', 'TRAFEGO', 'active',
       jsonb_build_object('source','e2e_seed','created_at', now()::text)
WHERE NOT EXISTS (
  SELECT 1 FROM portal.services
   WHERE client_slug = 'cliente-teste-e2e' AND service_type = 'TRAFEGO'
);

-- 3.13) Cria auth.users + portal.users pro login do cliente de teste.
--       Senha: TesteE2E#2026 (bcrypt via crypt + gen_salt('bf')).
--       O trigger handle_new_auth_user lê raw_user_meta_data->>'role' e
--       insere em portal.users com role='user' (NÃO 'client' — constraint
--       users_role_check só aceita 'user','admin','operator').
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated','authenticated',
  'teste-e2e@diamantes.grupoparticipa.app.br',
  crypt('TesteE2E#2026', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"user","name":"Cliente Teste E2E","client_slug":"cliente-teste-e2e"}'::jsonb,
  now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'teste-e2e@diamantes.grupoparticipa.app.br'
);

-- Garante client_slug + status corretos (handle_new_auth_user não passa
-- client_slug nem coloca status='approved' automaticamente).
-- Coluna real é `name`, não `display_name`.
UPDATE portal.users
   SET client_slug = 'cliente-teste-e2e',
       role        = 'user',
       status      = 'approved',
       name        = COALESCE(NULLIF(name, ''), 'Cliente Teste E2E')
 WHERE email = 'teste-e2e@diamantes.grupoparticipa.app.br';

-- 3.14) Verificação final — mostra estado pós-cleanup
SELECT
  (SELECT count(*) FROM portal.clients)                                              AS total_clients,
  (SELECT count(*) FROM portal.services WHERE status='active')                       AS active_services,
  (SELECT count(*) FROM portal.users WHERE role='user' AND client_slug IS NOT NULL)  AS client_users,
  (SELECT count(*) FROM auth.users WHERE email LIKE '%diamantes.grupoparticipa%')    AS diamante_auths;

-- Esperado:
--   total_clients   = 20  (19 verdade + 1 teste E2E)
--   active_services ≥ 55  (54 da migration 020 + 1 do teste)
--   client_users    ≥ 19  (pode ter duplicatas legacy)
--   diamante_auths  = 1   (apenas o teste E2E criado aqui)
--
-- Se tudo bater: COMMIT;
-- Se algo está errado: ROLLBACK;

-- COMMIT;   -- <— descomente para confirmar
-- ROLLBACK; -- <— ou descomente este para abortar

-- ============================================================================
-- Fim 019_cleanup_clients_off_truth_table.sql
-- ============================================================================
