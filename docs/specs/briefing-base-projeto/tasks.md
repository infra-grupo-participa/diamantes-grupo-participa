# Briefing em 2 Níveis + Chamados por Projeto — Tasks

**Design:** `docs/specs/briefing-base-projeto/design.md`
**Status:** Done — T0–T15 implementadas e deployadas (migration 031 aplicada; deploy FTP em produção). Teste funcional manual recomendado.

> **Nota de verificação:** o banco de produção do diamantes (`npqyvjhvtfahuxfmuhie`) não é acessível
> pelo MCP daqui; a migration é aplicada manualmente (Supabase SQL editor / deploy). Gate de cada task:
> SQL revisável + idempotente (`IF EXISTS`/`IF NOT EXISTS`), JS valida em `node --check`. Não há suíte
> unitária para essas telas vanilla; verificação funcional é manual no portal após deploy.

---

## Execution Plan

```
Phase 0 (independente):  T0 (dashboard chat)

Phase 1 (Foundation, sequencial — tudo na migration 031):
  T1 → T2 → T3 → T4 → T5

Phase 2 (Templates):      T1..T5 → T6

Phase 3 (API):            T6 → T7

Phase 4 (Telas, dependem de T6+T7):
        ┌→ T8  (briefing-basico)
  T7 ──┼→ T9  (briefing projeto)
        ├→ T10 (novo-projeto)
        ├→ T11 (projetos)
        ├→ T12 (dashboard gate)
        └→ T13 (demandas 2 modos)

Phase 5 (P2/P3, depois):  T14 (admin/projetos) · T15 (onboarding)
```

---

## Task Breakdown

### T0: Remover chat da equipe no dashboard
**What:** Tirar botão "Mandar mensagem" da lista de equipe + texto "Fale com sua equipe" (só visualização).
**Where:** `portal/dashboard.html`
**Depends on:** None • **Requirement:** DASH-01
**Done when:**
- [ ] `.team-action` (botão de mensagem) removido do markup e do CSS
- [ ] Texto "Fale com sua equipe..." substituído por CTA de chamado/projeto
- [ ] `node --check` não aplica (HTML); revisão visual do diff
**Tests:** none • **Gate:** revisão
**Commit:** `feat(dashboard): equipe somente leitura (remove chat na tela inicial)`

### T1: Tabela `portal.client_briefing` + RLS
**What:** Criar tabela do Briefing Básico (gate) e policies.
**Where:** `db/migrations/031_briefing_base_projeto.sql` (seção 1)
**Depends on:** None • **Requirement:** BASE-01, BASE-02
**Done when:**
- [ ] Tabela com `client_slug` PK, `access jsonb`, `base_status`, `pending_flags`, timestamps
- [ ] RLS: dono + admin + operador (read-only) — reusa padrão de 029
**Tests:** none • **Gate:** SQL idempotente

### T2: Reestruturar `portal.projects` (evento multi-serviço)
**What:** Add `services text[]`; tornar `service_type` legado nullable; transform best-effort do briefing antigo.
**Where:** migration 031 (seção 2) • **Depends on:** None • **Requirement:** PROJ-01
**Done when:**
- [ ] `services text[]` adicionado
- [ ] `service_type` nullable, CHECK antigo removido
- [ ] Transform: `briefing → {general:{}, services:{<service_type>:<briefing>}}`, `services := ARRAY[service_type]` p/ linhas existentes (map `web_design_automacao` → `paginas`+`automacao`)

### T3: RPCs do Base
**What:** `get_client_briefing`, `save_base_briefing`, `submit_base_briefing`, `client_base_ready`.
**Where:** migration 031 (seção 3) • **Depends on:** T1 • **Requirement:** BASE-01..03
**Done when:**
- [ ] As 4 funções `SECURITY DEFINER`, search_path setado, GRANT a `authenticated`
- [ ] `submit_base_briefing` valida acesso não-vazio + audit_log

### T4: RPCs do Projeto (substituem 029)
**What:** novo `create_project(title, general, services)`, `save_project_briefing`, `submit_project_briefing`; DROP das antigas (`create_project(text,text)`, `save_briefing_draft`, `submit_briefing`).
**Where:** migration 031 (seção 4) • **Depends on:** T2, T3 (gate) • **Requirement:** PROJ-01..02
**Done when:**
- [ ] `create_project` exige gate (`client_base_ready`) e valida `services ⊆ contratados`
- [ ] `save_project_briefing` faz merge profundo (general+services); `submit_project_briefing` valida red + audit
- [ ] Antigas dropadas com `IF EXISTS`

### T5: `create_demand` canônico + gate
**What:** DROP de todas assinaturas históricas; criar versão canônica (com `p_project_id`, sem `p_service_type`) + gate do Base.
**Where:** migration 031 (seção 5) • **Depends on:** T3 • **Requirement:** CHAM-01..02
**Done when:**
- [ ] DROP IF EXISTS das assinaturas conhecidas (027, 029)
- [ ] Versão canônica com gate (`client_base_ready`), `p_project_id` opcional, GRANT
- [ ] Comentário documentando a assinatura

### T6: Refatorar `briefing-templates.js`
**What:** `scope:'base'|'project'` em cada campo; split `paginas`/`automacao`; `ACTIVE_SERVICES`; `GENERAL_PROJECT_FIELDS`; helpers `getBaseFields`/`getProjectFields`/`getGeneralFields`/`validateBase`/`validateProjectBriefing`. Preencher campos novos dos 4 serviços (Apêndice A da spec).
**Where:** `portal/assets/briefing-templates.js` • **Depends on:** T1..T5 • **Requirement:** SVC-01..06
**Done when:**
- [ ] Todo campo tem `scope`; 4 serviços ativos completos conforme Apêndice A
- [ ] design_grafico/social_media fora de ACTIVE_SERVICES
- [ ] Helpers exportados em `window`; `node --check` passa

### T7: `portal-api.js` — wrappers + gate
**What:** `getClientBriefing`, `saveBaseBriefing`, `submitBaseBriefing`, novo `createProject`, `saveProjectBriefing`, `submitProjectBriefing`; `createDemand` alinhado (`p_project_id`); `requireClient` expõe `baseReady`.
**Where:** `portal/assets/portal-api.js` • **Depends on:** T6 • **Requirement:** BASE/PROJ/CHAM
**Done when:**
- [ ] Wrappers chamam as RPCs com nomes de parâmetro corretos
- [ ] `createDemand` não envia mais `p_service_type`; envia `p_project_id`
- [ ] `node --check` passa

### T8: `portal/briefing-basico.html` (novo)
**What:** Formulário do Base: pessoais read-only + seções de acesso dos serviços contratados; autosave; submit (gate).
**Where:** `portal/briefing-basico.html` • **Depends on:** T7 • **Requirement:** BASE-01..03
**Done when:**
- [ ] Renderiza `getBaseFields` por serviço contratado; pessoais read-only de `getMe`
- [ ] Autosave (`saveBaseBriefing`) + submit (`submitBaseBriefing`); badges 🔴🟡🟢; "não tenho" → pending
**Commit:** `feat(briefing): Briefing Básico do cliente (acessos, gate)`

### T9: `portal/briefing.html` (projeto multi-serviço)
**What:** Para projeto: bloco geral + seções `project` dos serviços contratados; acessos herdados read-only.
**Where:** `portal/briefing.html` • **Depends on:** T7 • **Requirement:** PROJ-01..02
**Done when:**
- [ ] Lê `briefing.general` + `briefing.services`; renderiza só serviços do evento
- [ ] Mostra acessos do Base read-only; mantém caminho de demanda intacto

### T10: `portal/novo-projeto.html` (criar evento)
**What:** Título + bloco geral; serviços derivados dos contratados; chama novo `createProject`.
**Where:** `portal/novo-projeto.html` • **Depends on:** T7 • **Requirement:** PROJ-01

### T11: `portal/projetos.html` (lista de eventos)
**What:** Listar eventos multi-serviço; progresso por red (geral + serviços do evento).
**Where:** `portal/projetos.html` • **Depends on:** T7 • **Requirement:** PROJ-01

### T12: `portal/dashboard.html` (gate banner)
**What:** Banner "Complete o Briefing Básico" + bloquear Novo Projeto/Chamado quando `!baseReady`.
**Where:** `portal/dashboard.html` • **Depends on:** T7 • **Requirement:** BASE-02

### T13: `portal/demandas.html` (chamado 2 modos + gate)
**What:** Modal: simples vs por-projeto (dropdown de eventos ativos); aplicar gate.
**Where:** `portal/demandas.html` • **Depends on:** T7 • **Requirement:** CHAM-01..02

### T14 (P3): `admin/projetos.html` — visão admin
### T15 (P2): Onboarding Diamante novo (acesso preparado, envio manual) — ONB-01

---

## Granularity Check
| Task | Escopo | Status |
|---|---|---|
| T0 | 1 arquivo (markup+css) | ✅ |
| T1–T5 | 1 seção SQL cada (1 migration) | ✅ |
| T6 | 1 arquivo (template) | ✅ coeso |
| T7 | 1 arquivo (api) | ✅ coeso |
| T8–T13 | 1 tela cada | ✅ |

## Diagram ↔ Definition Cross-Check
| Task | Depends on (body) | Diagrama | Status |
|---|---|---|---|
| T1 | None | — | ✅ |
| T2 | None | — | ✅ |
| T3 | T1 | T1→T3 | ✅ |
| T4 | T2,T3 | T2,T3→T4 | ✅ |
| T5 | T3 | T3→T5 | ✅ |
| T6 | T1..T5 | →T6 | ✅ |
| T7 | T6 | T6→T7 | ✅ |
| T8–T13 | T7 | T7→(fan-out) | ✅ |

> Tests: projeto sem suíte unitária para telas vanilla; matriz de cobertura = "none". Verificação
> funcional manual após deploy + quality-gate (lint/jscpd/gitleaks) no push.
