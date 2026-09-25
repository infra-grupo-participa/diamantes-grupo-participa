-- 088_assignee_alert_routing
-- Passo 1 do plano [[Diamantes - Plano definitivo de atribuicao de responsaveis
-- (24-09-2026)]]. Hoje o alerta de divergência (send-email, type
-- 'divergencia_assignee') vai para TODOS os admins aprovados (resolveAdminRecipients)
-- — 11 admins × divergência = 165 e-mails em 30 dias, 0 resolvidos (responsabilidade
-- difusa). Decisão do Marcio de 24/09 ([[2026-09-24 - Diamantes - 4 decisoes da
-- atribuicao de responsaveis]]): 1 dono (João Pedro Alves) recebe o alerta; os
-- demais continuam vendo a pendência no painel.
--
-- Mecanismo: portal.clickup_config.assignee_alert_to (key/value, mesma tabela das
-- chaves 'assignee_strategy'/'assignee_alert_email' da 086/087) — e-mail único ou
-- lista separada por vírgula. Lido por supabase/functions/send-email/index.ts
-- (resolveDivergenceAlertRecipients). Chave ausente ou vazia = comportamento antigo
-- (todos os admins aprovados) — reversão sem deploy, só apagar/esvaziar a linha.
--
-- Destinatário confirmado em 24/09/2026 pela listagem de membros do workspace do
-- ClickUp (João Pedro Alves, id 96634029 = joao@advmais.com) — decisão do Marcio na
-- mesma data. Trocar o dono = UPDATE no value, sem deploy.
--
-- Aplicar via `supabase db push` ou MCP apply_migration name=088_assignee_alert_routing.
-- Esta cópia em arquivo é a fonte da verdade versionada.

INSERT INTO portal.clickup_config (key, value)
VALUES ('assignee_alert_to', 'joao@advmais.com')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE portal.clickup_config IS
  'Config key/value do ClickUp (12+ linhas, Seq Scan é o plano correto — ver EXPLAIN
   da migration 086/088). Chave assignee_alert_to (088): destinatário(s) do alerta de
   divergência de responsáveis — e-mail único ou lista separada por vírgula. Lida por
   send-email (resolveDivergenceAlertRecipients). Ausente/vazia = fallback para todos
   os admins aprovados (comportamento anterior à 088).';

-- EXPLAIN (query exata do plano, tabela com 12 linhas):
--   explain (analyze) select key, value from portal.clickup_config;
--   → Seq Scan on clickup_config — esperado e correto (tabela pequena, sem índice
--     necessário; ver PROTOCOLO-SUSTENTABILIDADE.md, "tabela pequena Seq Scan é a
--     escolha certa do planner"). MEDIDO em 24/09/2026 pelo coordenador, antes de
--     aplicar: Seq Scan on clickup_config (actual rows=12, Buffers: shared hit=1,
--     Execution Time: 1.290 ms).
