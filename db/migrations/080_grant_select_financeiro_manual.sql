-- 080_grant_select_financeiro_manual.sql
-- Corrige bug: o modal financeiro do admin (FinanceClientModal) quebrava ao abrir
-- com "Erro ao carregar financeiro: [object Object]". Causa: as tabelas criadas em
-- 073_financeiro_manual_schema.sql têm RLS + policy admin-only (USING portal.is_admin()),
-- mas faltou o GRANT SELECT ao role `authenticated`. O Postgres barra no nível de
-- privilégio ANTES de avaliar a policy -> "permission denied for table payments",
-- que o supabase-js devolve como objeto (vira "[object Object]" no toast).
--
-- O Promise.all do reload() rejeita inteiro quando qualquer query falha, então NENHUMA
-- aba do modal carregava (inclusive a "Mês a mês", que já estava correta).
--
-- A policy is_admin() continua restringindo a leitura só a admins; conceder SELECT ao
-- authenticated apenas permite que a policy seja avaliada (cliente logado vê 0 linhas).
-- Mesmo padrão já usado em portal.hotmart_purchases (policy admin_all + GRANT SELECT).

GRANT SELECT ON portal.payments              TO authenticated;
GRANT SELECT ON portal.payment_agreements    TO authenticated;
GRANT SELECT ON portal.agreement_installments TO authenticated;
