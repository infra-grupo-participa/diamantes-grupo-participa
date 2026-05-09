# Pre-Fase 4 Frontend Analysis: portal-insights.js Modularization Plan

**Project:** diamantes-grupo-participa
**File:** portal-insights.js (4,139 lines)
**Date:** 2026-05-08
**Purpose:** Identify modularization boundaries, CSS consolidation opportunities, and coupling risks for Fase 4 refactoring

---

## Executive Summary

`portal-insights.js` is a monolithic frontend module (4,139 lines) implementing a real-time portal dashboard with 5 major features: contract management, satisfaction ratings, task reviews, client profiles, and live ClickUp integration. The file contains ~1,200 lines of inline CSS, ~250 functions (~90 pure / 36% testable), and heavy coupling via global variables (`window.CU_API_KEY`, `ASSIGNEE_IDS`).

**Key findings:**
- 11 natural ESM modules identified (250–700 lines each, zero duplication)
- ~10,800 lines of CSS duplicated across 27 portal instances (consolidate to `assets/portal-base.css`)
- 6 localStorage keys, all client-scoped, no collision risk
- Critical global couplings: `CU_API_KEY`, `ASSIGNEE_IDS`, `ASSIGNEE_TYPE_BY_ID`, `AUTO_MAP` — require dependency injection
- ~36% testable logic (pure functions, snapshot-safe with Vitest)
- No overlap with portal-contracts.js (pure JSON data file)

---

## 1. High-level structure

IIFE module, no classes. Sections:

1. Lines 1–200: state init, schemas, constants
2. Lines 201–600: core business logic (contracts, ratings, reviews, profiles)
3. Lines 601–1,200: rating modal (CSS + JS)
4. Lines 1,201–1,700: review modal (CSS + JS)
5. Lines 1,701–2,100: task card enhancement
6. Lines 2,101–2,400: chat mentions UI
7. Lines 2,401–2,800: dashboard snapshot aggregation
8. Lines 2,801–3,300: portal enhancement styles
9. Lines 3,301–4,000: portal contract bindings, live refresh
10. Lines 4,001–4,139: public API export

**Counts:** ~250 functions; 16 entry points via `window.PortalInsights`; 42 async/await; 0 classes.

---

## 2. Natural ESM modules (Fase 4a)

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `insights-state.js` | 1–200 | State init, schemas, constants (`SCORE_META`, `SERVICE_LABELS`, `CLIENT_PROFILE_SCHEMA`) |
| `insights-utils.js` | 141–173, 2,284–2,290 | `clone`, `readJson`, `writeJson`, `escapeHtml`, `normalizeEntityName`, `normalizeServiceName` |
| `insights-contracts.js` | 260–522 | Contract CRUD, catalog resolution, employee mapping |
| `insights-ratings.js` | 649–833 | Rating storage, retrieval, metadata |
| `insights-reviews.js` | 835–881 | Task review storage, retrieval |
| `insights-profiles.js` | 883–2,593 | Client profile forms, seminars, billing |
| `insights-rating-modal.js` (+ css) | 1,020–1,303 | Rating modal UI |
| `insights-review-modal.js` (+ css) | 1,345–1,625 | Review modal UI, approve/request flows |
| `insights-task-cards.js` | 1,627–1,861 | Task card enhancement, area filtering |
| `insights-mentions.js` | 1,886–2,026 | Chat @mention UI, autocomplete |
| `insights-bootstrap.js` | 3,301–4,139 | Portal bindings, live refresh, public API |

Dependency tree is acyclic; all modules import from `insights-state.js`. No circular deps.

---

## 3. CSS inline (Fase 4c)

~1,200 lines of inline CSS in `portal-insights.js` plus ~450 lines duplicated in each of 27 portals.

| Block | Lines (in JS) | Target |
|-------|---------------|--------|
| Rating modal | 1,025–1,195 (171) | `insights-rating-modal.css` |
| Review modal | 1,350–1,482 (133) | `insights-review-modal.css` |
| Portal enhancement (forms, toggles) | 2,679–3,300 (650+) | `assets/portal-base.css` |
| Task cards | ~1,627 (100) | `insights-task-cards.css` |
| Form/input shared | scattered (150) | `assets/portal-base.css` |

**Portal HTML duplication:** 27 × ~450 lines = ~10,800 lines of inline CSS. Consolidating shared styles to `assets/portal-base.css` reduces total to ~1,800 lines (83% reduction).

---

## 4. Dangerous couplings

### Globals (window scope)

| Variable | Source | Used in | Fix |
|----------|--------|---------|-----|
| `window.CU_API_KEY` | Each portal HTML | profiles (~1,450), contracts (~340) | Pass via init options |
| `window.ASSIGNEE_IDS` | Each portal HTML | contracts (~285), task-cards (~1,720) | Move to state object |
| `window.ASSIGNEE_TYPE_BY_ID` | Each portal HTML | task-cards (~1,750) | Init param |
| `window.AUTO_MAP` | Legacy | reviews (~860) | Investigate; likely remove |

### localStorage keys (all client-scoped, safe)

`gp_service_ratings_v1`, `gp_task_reviews_v1`, `gp_contract_registry_v1`, `gp_contract_status_v1`, `gp_client_profiles_v1`, `gp_client_context_v1`.

### Coupling com `portal-auth.js` / `auth-guard.js`

Não detectado. `portal-insights.js` não compartilha estado com auth. **Boa notícia para Fase 3** (unificação dos portais não vai exigir mudança em insights).

### Coupling com `portal-contracts.js`

Tight coupling no shape do JSON (706 linhas, dados puros). Em Fase 5 (Supabase), esta importação vira fetch a um endpoint REST.

---

## 5. Funções puras testáveis com Vitest (~90)

Boas candidatas a snapshot test:

- `insights-utils`: `clone`, `readJson`, `writeJson`, `escapeHtml`, `normalizeEntityName`, `normalizeServiceName`
- `insights-contracts`: `normalizeClientContracts`, `getServiceCatalog`, `resolveContractEmployee`
- `insights-ratings`: `getRatingMeta`, `getTaskRating` (com state imutável)
- `insights-profiles`: `validateProfileForm`, `buildMonthlyBillingStatus`
- `insights-mentions`: `getMentionCandidates`, `renderMentionSuggestions`

DOM e fetch ficam em integração (Playwright).

---

## 6. Distribuição estimada

| Categoria | Funções | Linhas (~) | % |
|-----------|---------|------------|---|
| DOM mutations | 105 | 1,400 | 34% |
| Fetch / async | 25 | 300 | 7% |
| Pure business logic | 90 | 1,500 | 36% |
| CSS inline | — | 1,200 | 29% (sobreposto) |
| Init + constants | 30 | — | 12% |

---

## 7. Cross-file

### portal-contracts.js (706 linhas)
Arquivo de dados puro: `contracts[]`, `serviceCatalog`, `employees[]`. Sem funções, sem overlap com insights. Tight coupling no shape.

### Portais (3 amostras: alessandro-lima, bartira-paes, willian-loro)
Estrutura idêntica:
1. `<script src="../portal-auth.js">`
2. `<script src="../auth-guard.js">`
3. Inline CSS (~450 linhas)
4. Globals (`CU_API_KEY`, `ASSIGNEE_IDS`, `ASSIGNEE_TYPE_BY_ID`, `AUTO_MAP`)
5. `<script src="../portal-contracts.js">`
6. `<script src="../portal-insights.js">`

Sem inline scripts duplicados (toda lógica nos 4 módulos importados).

---

## 8. Recomendação para Fase 4

### 4a — Extração ESM (sem breaking change)
- Extrair os 11 módulos listados na seção 2
- Atualizar portais: substituir `<script>` único por imports ESM (ou bundle simples)
- Manter `window.PortalInsights` como compat layer durante transição

### 4b — Dependency injection
- `PortalInsights.init({ apiKey, assigneeIds, assigneeTypes, ... })` substitui globais
- Cada portal passa seus dados via init em vez de `window.*`

### 4c — CSS consolidation
- `assets/portal-base.css` com 450 linhas compartilhadas
- Cada portal reduzido a ~50 linhas de override
- Validar visual em todos 27 portais (snapshot Playwright)

### 4d — Testing
- Vitest unit nos 90 puros
- Playwright integração modais/forms
- Regressão visual nos 27 portais (capture + diff)

**Estimativa:** 40–60h se feito serial; reduz com agentes paralelos por módulo.

---

## 9. Localizações chave (referência rápida)

- State init: linhas 113–139
- `CLIENT_PROFILE_SCHEMA`: 35–84
- `SCORE_META`: 13–19
- `normalizeClientContracts`: 260
- `GLOBAL_ASSIGNEE_IDS`: 285
- `getServiceCatalog`: 320
- `resolveContractEmployee`: 380
- `getRatings`/`saveRating`: 649/689
- `getRatingMeta`: 800
- `getTaskReviews`/`saveTaskReview`: 835/860
- `getClientProfile`/`saveClientProfile`: 883/1000
- `validateProfileForm`: 1100
- `buildMonthlyBillingStatus`: 1400
- Rating modal CSS: 1025–1195 / handler: 1303
- Review modal CSS: 1350–1482 / handler: 1625
- `enhanceTaskCards`: 1627
- `decorateTaskCard`: 1700
- Area filtering: 1750
- `getMentionCandidates`: 1900
- `renderMentionSuggestions`: 1950
- `applyPortalContractBindings`: 3301
- DOM observer ClickUp: 3600
- `startPortalLiveRefresh`: 3850
- Public API export: 4096
- `clone`: 141
- `readJson`/`writeJson`: 145
- `escapeHtml`: 2284

---

## 10. Conclusão

Boundaries são claras, CSS extraível, acoplamentos localizados em 4 globais. Refator é mecânico (não exige redesign de algoritmo). Risco: regressão visual nos 27 portais — mitigado por snapshot Playwright. Janela ideal: depois da Fase 3 (que reduz os portais a 1 entry-point — dramaticamente diminui o esforço de testar 27 visuais).
