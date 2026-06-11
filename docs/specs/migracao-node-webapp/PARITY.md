# PARITY.md — Planta de paridade do legado (checklist do porte)

Catálogo **exaustivo** de tudo que existe no sistema estático e precisa existir (aprimorado) no webapp Next.
Fonte: varredura read-only do legado (portal, admin, operador, PHP, Supabase). Use como contrato do porte —
nenhum item pode ser perdido. Marque [x] quando portado e validado.

> **Backend não muda.** O app novo **chama** as RPCs/views/tabelas existentes no Supabase (schema `portal`).
> Só os **5 endpoints PHP** viram Route Handlers. Vários RPCs/views vivem só no banco remoto (não versionados)
> — ver §5; basta chamá-los.

---

## 0. Fundações compartilhadas
- [ ] Cliente Supabase SSR (client/server/admin) — schema `portal`. ✅ (fase 0)
- [ ] Middleware de sessão + guards de role (cliente `user` / admin / operador). ✅ parcial (fase 0)
- [ ] **Design tokens** (paleta `#F29725`, Inter, surfaces, KPI tints, success/warn/danger). ✅ base (fase 0)
- [ ] **App shell** componentizado: topbar/sidebar, brand (diamante SVG), nav, **user-chip dropdown** (nome/email, Meus dados, Sair com confirm), toast global, overlay de loading.
- [ ] Helpers comuns: `initials`, `fmtDate`/`fmtDateTime` pt-BR, `fmtRelative`, `fmtBRL`, `escapeHtml` (auto no React), `starsHtml`, paginação, busca com debounce 280ms, `downloadBlob`/CSV (`;`, BOM UTF-8, decimal vírgula).
- [ ] `canonicalService`/`canonicalServiceName` (mapa de service_type→setor/label/cor) — usado em portal e admin.
- [ ] i18n de erros de auth (`translateAuthError`, porta de `supabase-i18n.js`). ✅ parcial no login.
- [ ] Motor de **briefing-templates** (ver §3). ⏳ em porte (TS).
- [ ] Normalizar inconsistências do legado: **topnav** (3 vs 4 itens; admin "Equipe" vs "Funcionários"; Demandas/Projetos faltando em menus), `planSince`/contractStart divergente, dois guards paralelos → unificar.

---

## 1. Portal do cliente (8 telas)

### 1.1 Login (`index.html`)
- [x] signIn + redirect por role + erros traduzidos (fase 0).
- [ ] alias `'admin'`→`admin@diamantes.local`; bloqueio de status pending/rejected/disabled; update `last_login_at`.

### 1.2 `/portal` (bridge) → dashboard
- [ ] redirect server-side preservando slug.

### 1.3 Dashboard (`dashboard.html`)
- [ ] Gate banner (Briefing Básico pendente → CTA).
- [ ] Hero (saudação + firstName + badge Diamante + "desde {contractStart}").
- [ ] Highlight "Sua semana" (pills: integrantes, serviços ativos).
- [ ] Card equipe (avatares por position_color), card serviços (ativos × aguardando pagamento), atividade recente (`formatEvent`, slice 6).
- [ ] Help CTA (gate-aware).
- [ ] Dados: RPC `get_my_dashboard` (user/client/profile/team/services/activity) + `get_client_briefing` (gate).
- [ ] Edge: time vazio, sem serviços, sem atividade; falha de rede não trava gate.

### 1.4 Demandas (`demandas.html`) — tela mais complexa (3 colunas)
- [ ] List-pane: filter-tabs (Todas/Em andamento/Aguardando você/Concluídas + counts), busca, items com status/unread.
- [ ] Chat-pane: mensagens agrupadas por dia, bolhas mine/outros, avatar, anexos, **composer** (anexar, autoresize, Enter envia).
- [ ] Detail-pane: sobre a demanda, **timeline de etapas** (aprovações N/M), rating banner, pessoas envolvidas (✓ aprovou), anexos (placeholder).
- [ ] **Realtime** (Supabase channel `demand:{id}`): onMessage/onDemandUpdate.
- [ ] **Modal Nova Demanda (wizard 2 steps)**: modo simples × por projeto (select de projetos active/briefing); step 2 título/descrição/operadores(checkbox)/início/prazo. Gate-aware.
- [ ] **Modal Avaliação** (nota 1–10 + comentário) → `submit_client_rating`.
- [ ] Botão **"Finalizar minha parte"** (operador membro) → `finalize_my_part` (alerta se done).
- [ ] Dados: `v_demands`, `demand_members`+`demand_operators`+`operators`+`positions`, `ratings`, chat via DemandChatAPI; RPCs `create_demand`, `finalize_my_part`, `submit_client_rating`.
- [ ] Helpers: STATUS_LABEL/TAG, dueLabel, categoryOf, fmtDayLabel, steps de aprovação.

### 1.5 Projetos (`projetos.html`)
- [ ] Grid de cards (tags de serviço, título, criado em, status-badge, **barra de progresso** do briefing, pill Rascunho/Enviado).
- [ ] `calcProgress` (campos red de geral + project sections via `validateProjectBriefing`).
- [ ] Dados: `projects` (direto). Click → briefing.

### 1.6 Novo projeto (`novo-projeto.html`)
- [ ] Nome do evento + grid de serviços contratados selecionáveis (pré-marcados).
- [ ] Gate (Briefing Básico enviado). `create_project(p_title,p_general,p_services)` → briefing.
- [ ] Edge: sem serviços contratados.

### 1.7 Briefing do projeto (`briefing.html`)
- [ ] Sidebar com progresso + nav de seções; main com header dinâmico; bottom-bar.
- [ ] **Units**: bloco geral (`getGeneralFields`) + por serviço seções `project` (campanha) + seções `base` (acessos **read-only herdados** com badge "Do Briefing Básico").
- [ ] renderField por tipo (boolean toggle, select, number/url/date/email/text, card), dependsOn condicional, GENERAL_HALF grid.
- [ ] **Autosave** (debounce 1200ms) `save_project_briefing`; progresso (campos red não-readonly).
- [ ] **Submit**: `validateProjectBriefing` → validationBar; `submit_project_briefing`; banner; **PDF (jsPDF)** → `POST /api/briefing-to-clickup` (Bearer + FormData). Falha de PDF não bloqueia.
- [ ] Edge: projeto não encontrado, já submitted.

### 1.8 Briefing Básico (`briefing-basico.html`) — gate
- [ ] Identificação read-only (nome/email/telefone).
- [ ] Por serviço: `getBaseSections` (acessos). Tipos especiais: **card** (bandeira/últimos4/validade), **boolean has_*** com **pending-note** (gera reunião).
- [ ] Autosave `save_base_briefing(access,pending)`; progresso via `validateBaseAccess`.
- [ ] Submit `submit_base_briefing` → libera portal → dashboard.

### 1.9 Perfil (`perfil.html`)
- [ ] Form pessoal (nome, email readonly, celular, cargo, empresa, cidade-UF, bio) + live preview.
- [ ] **Avatar** upload/remove (bucket `avatars`, ≤2MB).
- [ ] Segurança: alterar senha (`changePassword` ≥8), sessões/encerramento (stubs honestos).
- [ ] Assinatura: plan-card.
- [ ] **Notificações** (5 toggles) + **Preferências** (idioma/fuso/tema) → `user_preferences` (upsert).
- [ ] Dados: `getMe`/`updateMe` (só name+metadata), `getPreferences`/`setPreferences`.

---

## 2. Painel admin (5 telas)

### 2.1 Equipe/Funcionários (`index.html`)
- [ ] 5 KPIs (`getEmployeeStats`). 2 abas: Admins × Operadores.
- [ ] Admins: tabela (`v_employees`), filtros busca/status, ações Editar/Toggle(aprovar/desabilitar)/Excluir (prompt "EXCLUIR"). Modal admin (senha só na criação).
- [ ] Operadores: tabela (`v_operators`), cargo (position color), ClickUp ID, rating, alunos count; ações Editar/Toggle/Excluir. Modal operador (sem senha, cargo, clickup_user_id).
- [ ] CSV export. RPC `delete_employee`.

### 2.2 Alunos Diamantes (`alunos-diamantes.html`) — master-detail
- [ ] 4 KPIs (`getStudentStats`). Tabela (`v_students`): badge de vencimento, equipe/serviços count, billingBadge; filtros.
- [ ] Painel detalhe: stats, **equipe** (`get_student_team`, remover integrante), **serviços** (ativos × aguardando, badges de vencimento), métricas (barras).
- [ ] **Gerar acesso (ONB)**: `createClientAccess` → modal credenciais (copiável, senha uma vez, marca onboarding pending).
- [ ] Modal aluno (slug imutável, cor). Modal **atribuição de equipe**: select por setor (optgroup), regra **1 operador/setor/aluno** + só setores contratados (`get_student_contracted_positions`); `assignTeamMember`/`removeTeamMember`.
- [ ] CSV export.

### 2.3 Assinaturas/Financeiro (`assinaturas.html`) — master-detail
- [ ] 5 KPIs (`getSubscriptionStats`: MRR, ativos, inadimplentes, pendentes, retenção).
- [ ] Tabela (`v_subscriptions`): valor, próxima cobrança (cálculo de atraso), forma de pgto, status; filtros.
- [ ] **Painel financeiro**: MRR card + **sparkline SVG** (6 meses, `getMrrSparkline`), mini-stats (a receber/inadimplência/ticket), **serviços mais contratados** (barras), **receita por mês** (barras, `getPurchaseMonthlyStats`), **próximos vencimentos** (`v_service_renewals`), **histórico Hotmart** (`listPurchasesHistory`, filtros mês/cliente, paginação).
- [ ] Modal assinatura (cliente sem assinatura, plano, valor, status, forma). CSV export (assinaturas + compras).

### 2.4 Projetos/Briefings (`projetos.html`)
- [ ] Filtros (serviço/status/briefing). Tabela (`projects` + `clients(display_name)` direto): briefing badge + **progress-pill**, status.
- [ ] **Modal briefing read-only**: dados do evento + por serviço campanha + acessos herdados (de `client_briefing.access`). Usa briefing-templates.
- [ ] `calcProgress` (paridade com portal).

### 2.5 Demandas (Kanban) (`demandas.html`)
- [ ] 5 KPIs. **Toggle de visão**: Kanban (4 colunas, exclui canceled) × por aluno (colapsável, persist localStorage).
- [ ] Card: aprovações + barra, avatares operadores, badge prazo, msgs count, link ClickUp.
- [ ] **Modal detalhe**: mudar status (botões), meta-grid, equipe (ClickUp badge, ✓ aprovou), **chat read-only**.
- [ ] **Realtime** (`postgres_changes` demands+demand_members → reload).
- [ ] Dados: `listAllDemands`(`v_demands`), `getDemandFullDetails`, `adminUpdateDemandStatus`, `adminDemandStats`, `listClientsSimple`.

---

## 3. Motor de Briefing (`briefing-templates.js` → `lib/briefing-templates.ts`) ⏳
- [ ] Templates verbatim: `anuncios_pagos`(9 seções), `edicao_video`, `paginas`, `automacao` (+ legados ocultos `design_grafico`, `social_media`, `web_design_automacao`).
- [ ] Config 2 níveis: `BRIEFING_ACTIVE_SERVICES`, `BRIEFING_SERVICE_LABELS`, `BRIEFING_SECTION_SCOPE`, `BRIEFING_FIELD_SCOPE`, `GENERAL_PROJECT_FIELDS`.
- [ ] Helpers: `getFieldScope`, `getServiceSections`/`getBaseSections`/`getProjectSections`, `getGeneralFields`, `getBriefingRequiredFields`, `fieldIsEmpty`, `validateBriefing`, `validateBaseAccess`, `validateProjectBriefing`.
- [ ] Tipos TS (Priority, FieldType, BriefingField/Section/Template, Scope).
- [ ] Portar os **39 testes** unit (Vitest) deste módulo.

---

## 4. Chat (núcleo compartilhado)
- [ ] `DemandChatAPI` → `lib/chat.ts`: listMessages (join users), postMessage(WithClickup), **subscribe (realtime channel)**, uploadAttachment (bucket `demand-attachments`, ≤10MB, signed URL), signAttachment.
- [ ] `ChatComposer` → componente React: anexos (file/drag&drop/paste), previews, upload antes do envio, lightbox de imagem, hydrate de URLs assinadas.

---

## 5. Camada server (PHP → Route Handlers Next)
- [ ] `app/api/clickup` — proxy ClickUp v2 autenticado. **Replicar guards de segurança** (auditados): valida JWT via `/auth/v1/user`; admin livre; cliente valida slug+approved; **method allowlist** GET/POST; **BOLA guard** (path deve referenciar task/list do cliente); **SSRF** (sem path absoluto, https-only, no-follow).
- [ ] `app/api/clickup-comment` — mensagem cliente → comentário ClickUp (role=user, posse de slug, demanda do cliente; PATCH `clickup_synced_at`).
- [ ] `app/api/briefing-to-clickup` — PDF → task (projeto cria task; demanda anexa/cria; valida UUID + MIME pdf ≤20MB; PATCH `clickup_task_id`).
- [ ] `app/api/clickup-webhook` — HMAC-SHA256 + replay 300s; hoje só ACK.
- [ ] `app/api/hotmart-webhook` — hottok; eventos PURCHASE_*; RPCs `process_hotmart_purchase`, `get_client_slug_by_email`, `cancel_client_service`, `run_overdue_sync`.
- [ ] Secrets em env do servidor (não `.htaccess`). Refazer rewrite `/{slug}/`→dashboard como rota Next.
- [ ] `.htaccess` raiz: CSP/HSTS/headers → mover p/ `next.config` headers + middleware.

---

## 6. Área Operador (3 telas) — `operator/`
- [ ] Dashboard (`get_operator_dashboard`: KPIs, workload, urgent, recent, ratings recebidos, pontos/ranking).
- [ ] Demandas do operador (`v_my_assigned_demands`, chat, finalizar parte, avaliar cliente `submit_operator_rating`).
- [ ] Perfil do operador.
- [ ] `operator-api.js` → `lib/api/operator.ts`. Guard role=operator.

---

## 7. Contrato Supabase (call-only — não recriar)
- **Tabelas:** users, operators, positions, clients, client_profiles, client_briefing, services, hotmart_offers, hotmart_purchases, subscriptions, team_assignments, demands, demand_members, demand_operators, demand_messages, demand_status_log, ratings, operator_to_client_ratings, operator_points, projects, audit_log, rate_limits.
- **Views:** v_employees, v_operators, v_students, v_subscriptions, v_demands, v_service_renewals, v_my_assigned_demands, v_my_students, v_demand_lifecycle.
- **RPCs:** get_my_dashboard, get_operator_dashboard, get_client_briefing, save/submit_base_briefing, client_base_ready, client_briefing_services, create_project, save/submit_project_briefing, create_demand, finalize_my_part, submit_client_rating, submit_operator_rating, request_*_rating, expire_pending_ratings, get_student_team, get_student_contracted_positions, get_client_active_services, delete_employee, process_hotmart_purchase, recalc_subscription_from_services, sync_overdue_subscriptions, get_client_slug_by_email, cancel_client_service, run_overdue_sync, is_admin, can_access_demand.
- **Storage:** buckets `avatars` (público), `demand-attachments` (privado, signed).
- **Realtime:** `postgres_changes` em `portal.demands`, `portal.demand_members`, `portal.demand_messages`.
- ⚠️ Não versionados (extrair do remoto se precisar tocar): can_access_demand, finalize_my_part, delete_employee, get_client_active_services, get_client_slug_by_email, cancel_client_service, run_overdue_sync, v_students, v_subscriptions.

---

## 8. Roadmap de execução (fases)
- **Fase 0** ✅ scaffold + auth base.
- **Fase 1** — layouts portal/admin/operador + guards de role + i18n + helpers comuns.
- **Fase 2** — design system (app shell, user-chip, toast, tabela/paginação, modais, campos).
- **Fase 3** — motor de briefing TS + testes (§3).
- **Fase 4** — Portal: dashboard, perfil.
- **Fase 5** — Briefing básico + projeto + novo-projeto + projetos.
- **Fase 6** — Demandas (cliente) + chat realtime + composer.
- **Fase 7** — Admin: funcionários, alunos+ONB+equipe, assinaturas+financeiro, projetos, demandas kanban.
- **Fase 8** — Operador (3 telas).
- **Fase 9** — Route Handlers (5 PHP) + CSP/headers + rewrite slug.
- **Fase 10** — E2E (Playwright) apontando pro app; cutover por subdomínio; aposentar estático+PHP.
