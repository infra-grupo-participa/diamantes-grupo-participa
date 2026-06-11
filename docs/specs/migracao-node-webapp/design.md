# Migração para Webapp Node (Next.js) — Design

**Spec:** [spec.md](./spec.md) · **Status:** proposto (aguardando aprovação)

---

## 1. Arquitetura alvo

```
Browser ──► Next.js (App Router, Node runtime na Hostinger)
                │  React Server Components + Client Components
                │  middleware.ts (sessão/role)  ·  @supabase/ssr (cookies)
                ├── Server Components / Server Actions ─► Supabase (RLS, RPCs)  [anon key, sessão do usuário]
                ├── Route Handlers (app/api/*) ─────────► Supabase service-role + ClickUp/Hotmart  [secrets server-side]
                └── Realtime (client) ──────────────────► Supabase Realtime (chat de demandas)
```

- **Supabase inalterado** (projeto `npqyvjhvtfahuxfmuhie`): Auth, schema `portal`, RLS, RPCs, migrations.
- **Mesma anon key** no client (via sessão); **service-role só em Route Handlers/Server Actions**.
- **Sem `.htaccess`/PHP**: secrets em variáveis de ambiente do servidor Node.

### Stack
- **Next.js (App Router) + TypeScript** · React 18.
- **@supabase/ssr** (auth/cookies SSR) + **@supabase/supabase-js**.
- **CSS**: portar `briefing.css` + estilos inline → `globals.css` + CSS Modules por componente (estética idêntica). Tailwind opcional em fase posterior.
- **PDF** (briefing→ClickUp): `pdfkit`/`puppeteer-core` no Route Handler (substitui o PHP).
- **Tooling**: ESLint + Prettier + tipos do Supabase (`generate_typescript_types`).

---

## 2. Estrutura de pastas (proposta)

```
app/
  layout.tsx                      ← root (fontes Inter, providers)
  globals.css                     ← variáveis (--accent #F29725), reset, base
  (auth)/login/page.tsx           ← index.html
  (portal)/
    layout.tsx                    ← nav lateral cliente + guard de role 'user'
    dashboard/page.tsx            ← portal/dashboard.html (equipe read-only + serviços + gate banner)
    perfil/page.tsx               ← portal/perfil.html
    briefing-basico/page.tsx      ← portal/briefing-basico.html (gate, acessos, card)
    projetos/page.tsx             ← portal/projetos.html
    novo-projeto/page.tsx         ← portal/novo-projeto.html
    briefing/[projetoId]/page.tsx ← portal/briefing.html?projeto=
    demandas/page.tsx             ← portal/demandas.html (lista + chat + modal 2 modos)
  (admin)/
    layout.tsx                    ← nav admin + guard de role 'admin'
    funcionarios/page.tsx         ← admin/index.html
    alunos/page.tsx               ← admin/alunos-diamantes.html (+ ONB "Gerar acesso")
    assinaturas/page.tsx          ← admin/assinaturas.html
    projetos/page.tsx             ← admin/projetos.html (lista + modal briefing)
    demandas/page.tsx             ← admin/demandas.html
  api/
    clickup/route.ts              ← api/clickup.php (proxy autenticado)
    clickup-comment/route.ts      ← api/clickup-comment.php
    clickup-webhook/route.ts      ← api/clickup-webhook.php
    hotmart-webhook/route.ts      ← api/hotmart-webhook.php
    briefing-to-clickup/route.ts  ← api/briefing-to-clickup.php (PDF + anexo)
components/
  ui/ (Button, Card, Toggle, Modal, FieldGrid, SectionPanel…)  ← do briefing.css/.field-grid/.section-panel
  briefing/ (BriefingForm, FieldRenderer, CardField, AccessSection…)
  demandas/ (DemandList, DemandChat, NewDemandModal…)
lib/
  supabase/{client.ts,server.ts,middleware.ts}  ← @supabase/ssr (3 fábricas padrão)
  briefing-templates.ts           ← porta portal/assets/briefing-templates.js (+ tipos)
  i18n.ts                         ← porta assets/js/supabase-i18n.js
  api/{portal.ts,admin.ts}        ← portam portal-api.js / admin-api.js (server actions + hooks)
middleware.ts                     ← sessão + redirect por role
types/supabase.ts                 ← gerado do schema portal
```

---

## 3. Mapa de migração (atual → Next)

| Atual | Next | Notas |
|---|---|---|
| `index.html` + `portal-auth-v2.js` | `(auth)/login` + `middleware.ts` | `signInWithPassword`; redirect por role server-side |
| `auth-guard.js` | `middleware.ts` + guards de layout | Fim do guard client-side frágil |
| `assets/js/supabase-config.js` | `lib/supabase/{client,server}.ts` | anon no client; service-role só server |
| `assets/js/supabase-i18n.js` | `lib/i18n.ts` | tradução de erros |
| `portal/assets/portal-api.js` | `lib/api/portal.ts` | RPCs: get_client_briefing, save/submit_base, create_project, save/submit_project_briefing, create_demand |
| `admin/assets/admin-api.js` | `lib/api/admin.ts` | inclui `createClientAccess` (ONB) |
| `portal/assets/briefing-templates.js` | `lib/briefing-templates.ts` | tipar scope/dependsOn/card; reusar no render |
| `assets/js/{demand-chat-api,chat-composer}.js` | `components/demandas/DemandChat.tsx` | Supabase Realtime no client component |
| `portal/assets/briefing.css` + inline | `globals.css` + CSS Modules | estética idêntica |
| `api/*.php` (5) | `app/api/*/route.ts` (5) | secrets server-side; webhooks validam assinatura |

**RPCs/contratos do backend não mudam** — só o chamador (de supabase-js no browser → server action / client hook).

---

## 4. Autenticação (SSR)

- `middleware.ts`: lê sessão via `@supabase/ssr`; rota protegida sem sessão → `/login`; resolve `role`/`client_slug` (de `portal.users`) e barra área errada (cliente↔admin).
- Server Components leem dados já autenticados (RLS aplicada pela sessão).
- Mutations via **Server Actions** (cliente) ou Route Handlers (quando precisa service-role).

---

## 5. Endpoints server (substituem PHP)
- `api/clickup` / `api/clickup-comment`: proxy autenticado ao ClickUp (token server-side); valida sessão admin/operador.
- `api/clickup-webhook` / `api/hotmart-webhook`: validam assinatura/secret; processam eventos. **URLs podem mudar** → reconfigurar no ClickUp/Hotmart no cutover.
- `api/briefing-to-clickup`: monta PDF do briefing e anexa na task. Reimplementa o PHP em Node (pdfkit/puppeteer).

---

## 6. Hospedagem — Hostinger Node App (hPanel) ✅ DECIDIDO

**Escolha confirmada:** hospedar como **Node App** no hPanel (plano Business/Cloud), em **subdomínio**
(ex. `app.diamantes.grupoparticipa.app.br`), com o site estático atual no ar até o cutover.

### Como o Node App da Hostinger funciona (LiteSpeed + Passenger)
- No hPanel: **Avançado → Node.js / Setup Node App** → escolher versão do Node (usar **20 LTS+**),
  diretório da aplicação e **arquivo de inicialização** (startup file).
- O LiteSpeed sobe o processo Node e faz proxy pra ele; a app **não** escolhe a porta livremente
  (vem via `process.env.PORT`).
- Variáveis de ambiente (secrets) entram pelo painel do Node App — **não** em `.htaccess`.

### Adaptação do Next pra esse ambiente (restrições reais)
- `next.config.js` com **`output: 'standalone'`** → gera `.next/standalone` com servidor Node embutido.
- **Startup file** = `server.js` que sobe o Next em modo produção lendo `process.env.PORT`
  (custom server mínimo OU o `server.js` do standalone). Build (`next build`) roda **no deploy**, não no runtime.
- **Build local/CI** (o Node App não é bom pra buildar): subir `.next/standalone` + `.next/static` + `public`
  já buildados (via Git deploy + `npm ci && npm run build`, ou enviar artefato pronto).
- **Env vars** no painel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (públicas),
  `SUPABASE_SERVICE_ROLE`, `CLICKUP_TOKEN`, `HOTMART_*` (server-only).

### Risco & fallback
- Node App em shared **pode** ter limites (memória, processos, websockets) que apertam SSR/Realtime.
  Se apertar → **fallback VPS (KVM)** com `next start` atrás de Nginx + PM2 (mesma base de código).
- **Realtime do chat** (websocket) é o ponto a validar cedo (fase 5) nesse ambiente.

> **Pré-requisitos seus (fase 0):** versão do Node no painel, subdomínio criado apontando pro Node App,
> e onde colar as env vars. Eu monto o `server.js`/`next.config` e o passo de build.

---

## 7. Roadmap em fases (incremental, app novo em paralelo)

| Fase | Entrega | Depende |
|---|---|---|
| **0 — Scaffold** | Next+TS, lib supabase/ssr, env validado, globals.css base, deploy "hello" no host Node | host confirmado |
| **1 — Auth** | login + middleware + roles + layouts (portal/admin) | 0 |
| **2 — Design system** | componentes ui/ do briefing.css; nav; paridade visual | 1 |
| **3 — Portal core** | dashboard + perfil | 2 |
| **4 — Briefing** | básico (gate/acessos/card) + projeto (geral+serviços+herdados) | 2,3 |
| **5 — Demandas** | lista + chat realtime + modal 2 modos | 2 |
| **6 — Projetos** | lista + novo-projeto | 4 |
| **7 — Admin** | funcionários, alunos+ONB, assinaturas, projetos, demandas | 2 |
| **8 — API** | 5 Route Handlers (PHP→Node) + reconfig webhooks | 1 |
| **9 — Cutover** | E2E Playwright apontando p/ app; DNS/subdomínio→domínio; aposenta estático+PHP | todas |

Cada fase é entregável e testável de forma independente (princípio do tlc-spec-driven). MVP = fases 0–4.

---

## 8. Testes
- Reaproveitar a suíte Playwright (`tests/e2e/*`) apontando para o app Node (mesma Supabase, mesmo `e2e-bot`).
- Unit (Vitest) em `lib/briefing-templates.ts` (já temos 39 testes para portar).
- `wiring-contract` continua válido (backend não muda).

---

## 9. Riscos & mitigações
- **Hosting sem Node** → confirmar plano antes da fase 0 (bloqueante).
- **Regressão visual** → portar CSS verbatim; comparar lado a lado por tela.
- **Webhooks** (ClickUp/Hotmart) com URL nova → trocar no cutover, testar com replay.
- **Realtime do chat** → validar cedo (fase 5) em client component.
- **Escopo grande** → app em paralelo + cutover por subdomínio; nada quebra em produção durante a migração.

---

## 10. Decisões — FECHADAS (jun/2026)
1. **Hosting**: ✅ Hostinger **Node App** (hPanel, Business/Cloud), subdomínio; fallback VPS se apertar.
2. **Stack**: ✅ **Next.js (App Router) + TypeScript**.
3. **CSS**: ✅ portar **verbatim** o `briefing.css`/inline (estética idêntica); Tailwind só em fase opcional pós-migração.
4. **Estratégia**: ✅ **app novo em paralelo** (subfolder `web/` no repo, branch dedicada) + **cutover por subdomínio**.

### Pendências do usuário p/ destravar a fase 0
- [ ] Versão do Node disponível no painel (alvo: 20 LTS+).
- [ ] Subdomínio criado e apontado pro Node App.
- [ ] Local pra colar as env vars (Supabase URL/anon/service-role, ClickUp, Hotmart).
