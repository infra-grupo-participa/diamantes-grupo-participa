-- 081 — Fecha vazamento de RLS por views SECURITY DEFINER (owner=postgres).
-- v_subscriptions, v_demands e v_operator_performance foram criadas SEM
-- security_invoker, então rodavam com o privilégio do dono (postgres) e
-- IGNORAVAM o RLS das tabelas-base. As outras 9 views do schema já usam
-- security_invoker=on; estas 3 ficaram para trás.
--
-- Impacto corrigido:
--  * v_subscriptions tinha GRANT a anon -> visitante sem login lia as 20
--    assinaturas (nome, e-mail, valor, cobrança, forma de pgto, notas).
--  * v_demands / v_operator_performance -> qualquer usuário autenticado
--    (inclusive cliente comum) lia demandas e performance de todos.
--
-- Verificado pós-aplicação: anon->v_subscriptions negado; usuário aleatório
-- vê 0 em v_demands/v_operator_performance; admin real segue vendo tudo.

alter view portal.v_subscriptions        set (security_invoker = on);
alter view portal.v_demands               set (security_invoker = on);
alter view portal.v_operator_performance  set (security_invoker = on);

-- Defense-in-depth: financeiro é área admin; anon não deve ter SELECT.
revoke select on portal.v_subscriptions from anon;
