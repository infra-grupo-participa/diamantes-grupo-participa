# CONTINUE — checkpoint da migração Next

**Branch:** `feat/migracao-next`. Atualizado: 2026-06-11.

## STATUS: porte funcional COMPLETO ✅
Todas as fases de código feitas e commitadas. `tsc` + `next build` verdes (19 rotas).
**Smoke autenticado headless** (login cliente + admin contra Supabase real) → **10/10 telas sem erro de runtime**.
Falta só o **cutover/deploy** (depende de você — ver "Pré-requisitos do usuário" no fim).

Não smokado em runtime (sem usuário de teste/ID), mas compila e usa os mesmos componentes já validados:
- `/operator/*` (sem usuário operador de teste) · `/portal/briefing/[projetoId]` (precisa de um project id real).


## Feito (commitado)
- Fase 0 — scaffold Next 14 + TS (login SSR, middleware, server.js Node App).
- PARITY.md — planta exaustiva do legado (16 telas + chat + 5 PHP + contrato Supabase). **Fonte da verdade do porte.**
- Fase 3 — `web/lib/briefing-templates.ts` (motor portado, tipado, verbatim).
- Fase 1+2 — shell das 3 áreas (Topbar/Sidebar/UserChip), guards (`lib/auth`), design system (globals.css), helpers (`lib/format`,`lib/i18n`,`lib/toast`).
- Fase 4 (parcial) — **dashboard do cliente** (`web/app/portal/page.tsx` + `lib/api/portal.ts`).
- `jspdf` adicionado em `web/package.json` (para PDF do briefing) — falta `npm install`.

## Pendente (era o workflow `port-diamantes-screens`)
8 grupos paralelos, **nenhum concluído** (workflow interrompido):
1. portal: perfil + projetos + novo-projeto
2. portal: briefing-basico + briefing/[projetoId] (usa motor; BriefingForm compartilhado; jspdf)
3. portal: demandas + chat realtime + composer (lib/chat.ts, lib/api/demandas.ts)
4. admin: equipe (/admin) + projetos (lib/api/admin.ts)
5. admin: alunos + assinaturas/financeiro (sparkline, hotmart)
6. admin: demandas kanban + realtime
7. operator: dashboard + demandas + perfil (lib/api/operator.ts)
8. server: 5 PHP → `web/app/api/*/route.ts` (replicar guards do clickup.php)
Depois: rodar `npx tsc --noEmit` + `next build` em `web/`, corrigir, commitar; Fase 10 (E2E + cutover).

## Como retomar o workflow
```
Workflow({ scriptPath: "C:\\Users\\infra\\.claude\\projects\\c--Users-infra-Documents-Projetos-diamantes-grupo-participa\\b6751720-7659-4ab2-8c7a-0646629e9cf5\\workflows\\scripts\\port-diamantes-screens-wf_3b1ed6a4-d5e.js" })
```
(nenhum agente concluiu → roda tudo do zero; resumeFromRunId não ajuda aqui.)

## Regras do porte (no script, repetir se reescrever)
- Caveman / poucos tokens. Backend NÃO muda — só chamar RPCs/views (schema portal). 5 PHP viram Route Handlers.
- NÃO editar `globals.css` nem `lib/api/portal.ts`/`lib/format.ts` em paralelo → usar CSS Modules + libs por domínio + componentes em `components/<dominio>/`.
- Reusar `lib/supabase/{client,server}`, `lib/auth`, `lib/format`, `lib/briefing-templates`, shell/layouts (guard já aplicado).
- Telas interativas = Client Components espelhando o JS legado (RLS protege).
- Validar build no fim (orquestrador), não por agente.

## Pré-requisitos do usuário (deploy, fase tardia)
Node App hPanel: versão Node 20+, subdomínio, env vars (Supabase URL/anon/service-role, CLICKUP_TOKEN, CLICKUP_WEBHOOK_SECRET, HOTMART_HOTTOK).
