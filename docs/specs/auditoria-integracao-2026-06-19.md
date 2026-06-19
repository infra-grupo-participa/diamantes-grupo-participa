# Auditoria de Integração do Produto — Portal Diamantes

> Data: 2026-06-19 · Método: auditoria multi-agente em contextos isolados (read-only).
> Cobertura: 6 domínios mapeados → 47 fluxos de propagação → **13 verificados adversarialmente** (código + SELECT real no banco `npqyvjhvtfahuxfmuhie`) antes de a frota bater o limite de sessão. Os 34 fluxos restantes ficam listados como **pendentes** (hipóteses, várias já com SELECT dos mapeadores) para uma segunda passada.

---

## 1. Resumo executivo

O **núcleo financeiro está saudável e bem posicionado**: a régua de renovação (`charged_at + 30`, sem acúmulo) não infla — 47/47 serviços com cobrança batem `access_until = última cobrança + 30`; o status da assinatura deriva de `services.access_until` via `recalc_subscription_from_services` + trigger + cron diário (jobid 6, rodou hoje 04:00). MRR (R$ 59.900) confere entre as duas fontes **hoje**.

Os problemas concentram-se em **propagação entre módulos** e **observabilidade de exceções**, não na lógica feliz. Três quebras de **alto impacto**:

1. **Avatares de equipe não aparecem em NENHUM card** do Kanban/por-aluno do admin (fonte de dados errada: lê `demand_members`, onde operador nunca existe; eles vivem em `demand_operators`).
2. **6 clientes aprovados não conseguem abrir demanda** — não têm `team_assignments`, o modal pré-seleciona "todos os operadores" e a RPC rejeita 100% deles.
3. **Compra Hotmart real (R$ 1.300, COMPLETE) sumiu do MRR** por não casar e-mail com `users` (role='user'); o webhook respondeu `ok:true` silencioso.

Padrão recorrente: **ações manuais/automáticas não reconciliam estado correlato** (concluir projeto ↔ demandas abertas; inativar operador ↔ demandas vigentes/ClickUp) e **falhas de integração são silenciosas** (pg_net fire-and-forget, `matched:false` ignorado). Há ainda **resíduos do sistema de notas** e **métricas mortas/congeladas** a limpar.

---

## 2. Quebras de integração (ação que não propaga)

Ordenado por severidade. Todas verificadas em código + banco.

| # | Fluxo | Sev. | Gap | Correção sugerida | Onde |
|---|-------|------|-----|-------------------|------|
| 1 | Avatares no card admin | **ALTA** | Cards leem `demand_members` + filtro `role='operator'` (sempre vazio) → 100% "sem equipe", mesmo nas demandas com operadores reais | Trocar fonte para `demand_operators`/`operators` (mesma do detalhe `getDemandOperators`); remover filtro `role==='operator'`; assinar realtime em `demand_operators` | `app/admin/demandas/page.tsx:77`, `lib/api/admin-demandas.ts:103-123`, `components/admin/DemandCard.tsx:36` |
| 2 | Cliente sem equipe não cria demanda | **ALTA** | 6 clientes aprovados com 0 `team_assignments`; fallback "todos operadores" pré-seleciona 11, RPC rejeita todos (`Operador não autorizado`) → criação trava | `listOperatorsForClient`: retornar **lista vazia** (não "todos ativos") → modal mostra "equipe não montada"; garantir `team_assignments` no onboarding; alerta admin p/ os 6 clientes | `lib/api/demandas.ts:237-246` |
| 3 | Hotmart sem match de e-mail | **ALTA** | E-mail que não casa `users(role='user')` grava `client_slug=NULL`, pula renovação; webhook `ok:true`/`matched:false` ignorado. Real: `anna@mattosrochaadvogados.com.br` R$1.300 COMPLETE fora do MRR | KPI/badge "compras não vinculadas"; inspecionar `matched` no route e alertar; fallback de match por `clients/owner_email` + job de reconciliação; reprocessar a compra de R$1.300 | `app/api/hotmart-webhook/route.ts:191-206`, `process_hotmart_purchase` |
| 4 | Concluir projeto deixa demandas órfãs | MÉDIA | `complete_project` só seta status+audit; demandas `open/in_progress/review` do projeto continuam ativas e indistinguíveis, sem aviso. Assimetria: `create_demand` já bloqueia nova demanda em projeto concluído | Guard em `complete_project`: bloquear/avisar se houver demandas abertas (espelhar estilo de `create_demand`) — lógica no banco | `complete_project` (migr. 055), `ProjetosClient.tsx:273` |
| 5 | Demanda↔Projeto sem propagação | MÉDIA | Concluir todas as demandas não muda `projects.status`; e admin conclui projeto sem validar demandas. Ambos 100% manuais e desacoplados | Trigger `AFTER UPDATE OF status` em `demands` sinalizando "pronto p/ concluir" + guard em `complete_project` (não auto-fechar, preservar gate do admin) | `client_complete_demand`, `complete_project` |
| 6 | Inativar/remover operador não reflete | MÉDIA | Operador inativado/removido do time permanece em `demand_operators` das demandas abertas e como assignee no ClickUp; sem trigger/cron de reconciliação | **Decidir política** (pode ser intencional p/ histórico). Se desvincular: trigger em `operators`/`team_assignments` chamando `_resync_demand_assignees` (já existe em migr. 059). Senão: avisar na UI de inativação | `lib/api/admin.ts:388`, `admin-alunos.ts:361-381` |

---

## 3. Métricas incoerentes / mortas

| Métrica | Sev. | Diagnóstico | Ação |
|---------|------|-------------|------|
| `v_demands.operators_approved` | BAIXA | **Métrica morta**: cruza `demand_members.role='operator'` (nunca existe) × `approved_finish` → sempre 0. Sem consumidor na UI | Remover coluna da view + campo `operators_approved` em `admin-demandas.ts:27` |
| "Ativos hoje" (admin) | MÉDIA* | KPI congelado: nada atualiza `last_login_at` (`logged_today=0`, max = 2026-06-11) | Popular `last_login_at` no login (middleware/auth) ou trocar o KPI por métrica real |
| KPIs demandas (topo) vs colunas por-aluno | MÉDIA* | Topo usa `adminDemandStats()` **sem filtro**; colunas usam `listAllDemands(filter)` → números "não batem" por design misto | Unificar a fonte/filtro ou rotular claramente "totais globais" vs "filtrados" |
| MRR — duas fontes | BAIXA* | `getSubscriptionStats` (Σ `subscriptions.monthly_value`) vs `admin_money_summary` (sobre `services`). Hoje fecham (59.900=59.900) porque o recalc mantém espelho | Derivar ambos da mesma fonte ou documentar invariante; alerta se divergirem |
| Aluno com `billing_status` NULL | BAIXA* | `total=23` mas `active+partial+overdue=22`; 1 aluno NULL não entra em nenhum bucket | `coalesce` p/ bucket "sem cobrança"/"indefinido" |
| `ratingAvg` fantasma (admin) | BAIXA* | Resíduo das notas: valores congelados/0.00 onde o componente `Stars` ainda renderizar | Remover Stars/ratingAvg remanescentes (Equipe já limpa; varrer demais telas) |

\* pendente de verificação adversarial formal — diagnóstico vem do mapeamento (vários com SELECT real).

---

## 4. Coerência de produto / resíduos a limpar

**Sistema de notas (removido, reversível)** — resíduos que ainda "mentem" sobre o comportamento ou reagiriam:
- `trg_award_points` em `ratings` ainda **ENABLED** — único caminho que reagiria a uma nota nova (inofensivo hoje, UI não insere). *Avaliar desligar p/ consistência.*
- Texto/UX que "promete avaliação" em concluir projeto/demanda enquanto os triggers de convite estão DISABLED (comentário/cópia stale).
- Órfãos puros de banco sem uso no app: `submit_operator_rating`, `v_project_ratings`, `expire_pending_ratings` (função sem cron). Mantidos de propósito p/ reversão — **documentar** como "congelados".
- `rating-banner` no portal: a RPC de pendências ainda é consultada a cada load (custo+acoplamento) e o bloco renderiza se `pendingRatings>0` (`app/portal/page.tsx:234-247`). Como nada gera pendência nova, é dormente — mas vale remover a chamada.
- Componentes órfãos: `OperatorPerformanceDrawer.tsx`, `RatingModal`, `ProjectRatingBanner` (sem import).

**E-mails ao cliente (pausados)** — confirmado em banco:
- 5 gatilhos (`demands_email_notify`, `demand_email_status_change`, `trg_demand_done_request_ratings`, `projects_email_notify`, `trg_project_completed_request_rating`): **DISABLED** ✓.
- Cron `_retry_failed_emails` (jobid 9, */5 min): **ATIVO**. Hoje no-op (`email_log` = 14 sent, 0 failed/pending). **Risco latente**: não respeita a flag de pausa — se um gatilho for reativado ou outra fonte gerar `pending`, ele reenviaria. *Recomendo: enquanto durar a pausa, ou desligar jobid 9, ou filtrar o tipo no `send-email` (preservando e-mails de auth/reset).*

**Integração ClickUp** (pendente de verificação formal, hipóteses do mapeador):
- `briefing-to-clickup` modo **demanda** usa `clients.cu_list_id` legado (folderless), inconsistente com a hierarquia nova pasta→lista→tarefa do modo projeto. Duas chaves distintas (env `CLICKUP_TOKEN` vs vault).
- `demands_clickup_update` não observa `project_id`/`client_slug` → mover demanda de projeto não re-resolve a lista no ClickUp.
- `mapStatusReverse` (webhook ClickUp→portal) só conhece 5 status PT-BR fixos; status customizado retorna null e é ignorado.
- `pg_net` fire-and-forget em todos os syncs: falha não volta ao admin (toast otimista "será sincronizado"). Só anexos têm retry (jobid 8).
- Operador sem `clickup_user_id` (1/12 ativos) conta nas métricas mas nunca vira assignee, sem aviso.

**Portal cliente** (pendente):
- `client_briefing_services` mapeia só 4 chaves e joga Hospedagem em `paginas`, descartando Design → divergência entre o que o dashboard mostra e o que `novo-projeto` oferece.
- Onboarding: passos 2 e 3 com `done:false` **hardcoded** e sem CTA/href acionável.
- Noção "sem operador" existe só no admin (implementada agora) — o cliente sempre vê serviço ativo como "Ativo". *Decidir se expõe ao cliente.*

---

## 5. Manter / Mover / Remover

**Manter onde está (arquitetura correta):**
- Toda a régua financeira no banco (`process_hotmart_purchase`, `recalc_subscription_from_services`, trigger em `services`, cron jobid 6). Fonte da verdade no Postgres; o app só lê. ✓
- Agregações de demanda/SLA em views (`v_project_demand_stats`, `v_demands`) — consistentes entre os caminhos de escrita (cliente RPC e admin direto).
- RPCs `admin_add/remove_demand_operator` + `_resync_demand_assignees` e diff de assignees na edge `clickup-sync`.

**Mover/corrigir de lugar:**
- Fonte dos avatares dos cards: de `demand_members` → `demand_operators` (alinhar com detalhe e panorama).
- Fallback "todos os operadores" em `listOperatorsForClient`: remover — gera seleção que o backend garantidamente recusa.
- Guard de integridade projeto↔demanda: nasce no banco (`complete_project`/trigger), só **espelhado** na UI (não implementar só no front).

**Remover (resíduo seguro):**
- `v_demands.operators_approved` + tipo correspondente.
- Overload antigo de `create_demand` (sem `p_project_id`) — landmine de resolução de função.
- Contadores vestigiais de `run_overdue_sync` (o efeito útil vem de `sync_overdue_subscriptions`); idealmente o webhook chama `sync_overdue_subscriptions` direto.
- Componentes/RPCs órfãos de rating (após decisão de não reverter).

---

## 6. Top 5 ações priorizadas (impacto × esforço)

1. **[ALTO impacto · BAIXO esforço]** Corrigir fonte dos avatares dos cards admin (`demand_operators`). Hoje 100% dos cards mostram "sem equipe".
2. **[ALTO · BAIXO]** Remover fallback "todos operadores" + alertar os 6 clientes sem `team_assignments`. Hoje eles **não conseguem abrir demanda**.
3. **[ALTO · MÉDIO]** Observabilidade Hotmart "não vinculado": badge/KPI + checar `matched` no webhook + reprocessar a compra de R$1.300. Receita real sumindo do MRR sem rastro.
4. **[MÉDIO · BAIXO]** Decidir e implementar guard `complete_project` (demandas abertas) — coerência do ciclo projeto↔demanda.
5. **[MÉDIO · BAIXO]** Higiene de e-mail pausado: desligar/filtrar cron jobid 9; e limpeza dos resíduos de notas (métrica morta, overload órfão, `trg_award_points`).

---

## Anexo — fluxos pendentes de verificação (2ª passada)

Não verificados adversarialmente por limite de sessão (rodar a Fase 2 do workflow após o reset):
`mrr-duas-fontes-divergentes`, `renovar-servico-mrr-divergente`, `servico-sem-valor-sem-oferta-zera-mrr`, `edicao-manual-assinatura-sobrescrita-por-recalc`, `billing-source-manual-harmoniza-regua`, `cancelamento-matching-por-email-sem-role`, `aluno-sem-billing-some-dos-segmentos`, `admin-login-ativos-hoje`, `concluir-demanda-kpi-vs-coluna`, `equipe-operadores-contagem-fontes-distintas`, `criar-demanda-cria-task-clickup`, `atribuir-operador-na-criacao-assignee-vazio`, `admin-adiciona-operador-resync-assignee`, `mudar-status-demanda-reflete-clickup`, `webhook-status-clickup-atualiza-demanda`, `briefing-enviado-vai-pro-clickup`, `comentario-chat-vai-pro-clickup`, `comentario-clickup-vira-mensagem-chat`, `submit-briefing-projeto-pdf-clickup-silencioso`, `servicos-contratados-divergencia-dashboard-vs-novoprojeto`, `servico-sem-operador-ausente-no-cliente`, `onboarding-steps-2e3-sempre-pendentes`, `projetos-card-submitted-redireciona-demandas`, `briefing-link-navigation-projeto-nao-encontrado`, `concluir-demanda-cliente-reflete-contadores`, e os resíduos de rating (`trigger-award-points-residuo`, `expire-pending-ratings-funcao-sem-cron`, `rpcs-views-rating-sem-uso-no-app`, `admin-stats-ratingavg-fantasma`, `concluir-projeto-promete-avaliacao-inexistente`, `concluir-demanda-comentario-stale`, `rating-banner-orfao-ainda-consultado`).
