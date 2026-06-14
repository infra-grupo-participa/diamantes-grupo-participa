-- ============================================================================
-- 034_emails_orfaos_reprocess.sql
-- ----------------------------------------------------------------------------
-- Corrige o matching por e-mail do webhook Hotmart (risco R1).
--
-- Contexto: process_hotmart_purchase resolve client_slug por
--   lower(email) AND role='user'. Quando a Hotmart cobra num e-mail diferente
--   do cadastrado, client_slug fica NULL e o serviço NÃO renova.
--
-- Órfãs detectadas em 12/06/2026 (hotmart_purchases.client_slug IS NULL):
--   - crnaranjo82@gmail.com   → é a Cynthia (cynthia-naranjo). RESOLVÍVEL aqui:
--       cadastro só tem contato@debemcomseusbens.com → adiciona alias.
--       Cobrança oo578cny (Web Design 2025) de 03/06 será reprocessada.
--   - anna@mattosrochaadvogados.com.br → "Anna Paula Sabino", SEM cadastro no
--       portal (não é um dos diamantes da tabela-verdade). NÃO resolvida aqui;
--       precisa criar o cliente antes. Fica órfã de propósito.
--
-- portal.users aceita múltiplos e-mails por client_slug (coluna is_primary).
-- O alias entra com password_hash='' e is_primary=false → serve só ao matching
-- do webhook, NÃO habilita login (hash vazio bloqueia autenticação).
--
-- Pré-requisito: 033 já aplicada (régua nova é usada no reprocesso).
-- TRANSACIONAL. Revise os SELECTs de verificação e então COMMIT.
-- ============================================================================

BEGIN;

-- 1) Alias de e-mail da Cynthia (clona name/status/client_slug do cadastro dela)
INSERT INTO portal.users (email, name, password_hash, role, status, client_slug, is_primary, metadata)
SELECT 'crnaranjo82@gmail.com', u.name, '', 'user', u.status, u.client_slug, false,
       COALESCE(u.metadata,'{}'::jsonb) || jsonb_build_object(
         'alias_of', u.email,
         'alias_reason', 'hotmart_email_match',
         'alias_created_by', '034_emails_orfaos_reprocess'
       )
FROM portal.users u
WHERE u.client_slug = 'cynthia-naranjo' AND u.role = 'user'
ORDER BY u.is_primary DESC
LIMIT 1
-- idempotência: não duplica se já existir (qualquer constraint de unicidade)
ON CONFLICT DO NOTHING;

-- (Opcional / preventivo) e-mail antigo do Osvaldo. As cobranças nele são de
-- março (pré-webhook) e não estão órfãs hoje, mas adicionar o alias evita que
-- uma futura cobrança nesse e-mail deixe de casar. Descomente se quiser:
-- INSERT INTO portal.users (email, name, password_hash, role, status, client_slug, is_primary, metadata)
-- SELECT 'osvaldo@catena.adv.br', u.name, '', 'user', u.status, u.client_slug, false,
--        COALESCE(u.metadata,'{}'::jsonb) || jsonb_build_object('alias_of', u.email, 'alias_reason','hotmart_email_match')
-- FROM portal.users u WHERE u.client_slug='osvaldo-catena' AND u.role='user'
-- ORDER BY u.is_primary DESC LIMIT 1 ON CONFLICT DO NOTHING;

-- 2) Preenche client_slug nas cobranças que agora casam por e-mail
UPDATE portal.hotmart_purchases p
   SET client_slug = u.client_slug
  FROM portal.users u
 WHERE p.client_slug IS NULL
   AND u.role = 'user'
   AND lower(u.email) = lower(p.buyer_email)
   AND u.client_slug IS NOT NULL;

-- 3) Reprocessa as cobranças recém-religadas: cria/renova o service do setor
--    aplicando a régua nova (033). Idempotente (process faz upsert).
SELECT portal.process_hotmart_purchase(
         p.transaction_code, p.buyer_email, p.offer_code, p.service_name,
         p.amount, p.status, p.payment_type, p.installments_total,
         p.installment_number, p.charged_at, p.raw_payload
       )
FROM portal.hotmart_purchases p
JOIN portal.users u
  ON u.role = 'user' AND lower(u.email) = lower(p.buyer_email)
WHERE p.status IN ('approved','complete')
  AND p.offer_code IS NOT NULL AND p.offer_code <> ''
  AND p.client_slug = u.client_slug
  AND p.buyer_email IN ('crnaranjo82@gmail.com');  -- só as órfãs resolvidas agora

-- 4) VERIFICAÇÃO --------------------------------------------------------------

-- 4a) Ainda há órfãs? (esperado: só anna@mattosrochaadvogados.com.br)
SELECT buyer_email, count(*) AS cobrancas
FROM portal.hotmart_purchases
WHERE client_slug IS NULL AND status IN ('approved','complete')
GROUP BY buyer_email;

-- 4b) Serviço da Cynthia foi criado/renovado? (esperado: 52pqh4nd + oo578cny)
SELECT client_slug, offer_code, service_type, status, access_until
FROM portal.services
WHERE client_slug = 'cynthia-naranjo'
ORDER BY offer_code;

-- Se ok: COMMIT;  /  Se algo estranho: ROLLBACK;
-- COMMIT;
-- ROLLBACK;

-- ============================================================================
-- Fim 034_emails_orfaos_reprocess.sql
-- ============================================================================
