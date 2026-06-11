# Migração para Webapp Node (Next.js) — Specification

**Versão:** 1.1 — Junho/2026
**Status:** ✅ Aprovado — Next.js + TypeScript · Hostinger Node App · app em paralelo (ver Design §10)
**Autor:** Márcio / Claude
**Método:** tlc-spec-driven (Specify → Design → Tasks → Execute)

---

## Problem Statement

O portal hoje é **HTML/JS vanilla estático** (13 páginas) servido pela Hostinger/LiteSpeed via FTP,
com uma camada PHP fina (`api/*.php`) e backend Supabase. Desenvolver virou doloroso: lógica e markup
duplicados entre páginas, sem componentização, sem reuso, sem tipos, deploy por mirror de arquivos, e
secrets injetados via `.htaccess`. Bugs recentes (audit_log, GRANTs, render de card) só apareceram em
produção porque não há build/checagem real nem ambiente de app.

**Meta:** re-plataformar o **frontend/serving** para um **webapp Node** (mantendo a estética e as
funcionalidades), facilitando o desenvolvimento. O **backend Supabase permanece** (Auth, Postgres
`portal`, RLS, RPCs, migrations) — não é reescrito.

---

## Goals

- [ ] App Node componentizado (fim do HTML/JS duplicado) — desenvolver feature nova é rápido e seguro.
- [ ] **Estética idêntica**: portar o CSS atual (paleta laranja `#F29725`, Inter, layouts) sem mudança visual perceptível.
- [ ] **Paridade funcional**: login/roles, gate do Briefing Básico, Briefing por projeto (evento), demandas (lista+chat), projetos, perfil, painéis admin, ONB, proxy ClickUp, webhooks, PDF→ClickUp.
- [ ] Secrets **server-side** (sem `SetEnv` em `.htaccess`); service-role só no servidor.
- [ ] Auth/sessão robusta server-side (substitui o guard client-side frágil).
- [ ] Deploy reproduzível para hospedagem **Node na Hostinger** (VPS ou Node App), separada do site estático atual.
- [ ] TypeScript + tipos do Supabase (menos bugs como os de schema divergente).

---

## Out of Scope

| Item | Motivo |
|---|---|
| Reescrever o backend Supabase | Permanece como está (Auth/RLS/RPCs/migrations) |
| Mudar o schema `portal` | Migração é de frontend/serving, não de dados |
| Redesign visual | Meta é manter a estética; modernização (Tailwind/shadcn) fica como fase opcional pós-migração |
| Migrar dados | Nada a migrar — mesma Supabase |
| App mobile nativo | Fora do escopo |

---

## Decisão de stack — Next.js vs Express

| Critério | **Next.js (App Router)** ✅ | Express + templates |
|---|---|---|
| Componentização / reuso | Nativo (React) — resolve a dor central | Manual (EJS/Handlebars), pouco reuso |
| Auth Supabase | `@supabase/ssr` (cookies, SSR, RLS) — padrão consolidado | Manual (cookies + supabase-js) |
| Substituir PHP (proxy/webhooks/PDF) | Route Handlers (`app/api/*`) no mesmo runtime | Rotas Express (também ok) |
| Secrets server-side | Server Components / Route Handlers | Middleware Express |
| DX / velocidade futura | Alta (file-routing, RSC, HMR, TS) | Média |
| Esforço de migração | Maior (vira React) | Menor (pode servir HTML quase como está) |
| Hospedagem Hostinger | Precisa de Node runtime (VPS / Node App) | Precisa de Node runtime (igual) |

**Recomendação: Next.js (App Router) + TypeScript.** É o que melhor ataca "página estática é ruim /
facilitar o desenvolvimento": componentes, server actions, route handlers no lugar do PHP, e auth SSR
do Supabase. Express só venceria se a meta fosse mudar o mínimo — não é o caso.

> ⚠️ **Decisão a confirmar com você** (única que muda execução): **alvo de hospedagem na Hostinger** —
> VPS (KVM, Node livre, recomendado) vs "Node App" do hPanel (planos Business/Cloud). Ver Design §Hosting.

---

## User Stories

### P1: Scaffold + paridade de Auth ⭐ MVP
**Como** dev, **quero** o app Next rodando com login/sessão Supabase e redirecionamento por role,
**para** ter a base sobre a qual portar as telas.
**Acceptance:**
1. WHEN usuário acessa `/` deslogado THEN vê a tela de login (estética atual).
2. WHEN faz login válido THEN sessão é estabelecida via cookies SSR e é redirecionado: admin→`/admin`, cliente→`/portal`.
3. WHEN acessa rota protegida sem sessão THEN middleware redireciona para login.
**Independent test:** login cliente e admin → chega na home correta; rota protegida deslogado → login.

### P1: Estética portada (design system) ⭐ MVP
**Como** usuário, **quero** que as telas no Next pareçam idênticas às atuais.
**Acceptance:** `briefing.css` + estilos inline portados; paleta/tipografia/layout sem regressão visual.

### P1: Portal do cliente (paridade) ⭐ MVP
Dashboard (equipe só-leitura + serviços + gate), Perfil, **Briefing Básico** (gate, acessos, card),
**Projeto/evento** (criar + briefing geral + seções por serviço contratado + acessos herdados),
**Demandas** (lista + chat + chamado 2 modos), Projetos (lista).
**Acceptance:** cada fluxo funciona igual ao atual, contra a mesma Supabase (RLS/RPCs).

### P2: Painel admin (paridade)
Funcionários, Alunos Diamantes (+ ONB "Gerar acesso"), Assinaturas, Projetos/Briefings, Demandas.

### P2: Endpoints server (substituem PHP)
Route Handlers: `clickup` (proxy autenticado), `clickup-webhook`, `clickup-comment`, `hotmart-webhook`,
`briefing-to-clickup` (gera PDF + anexa). Secrets só no servidor.
**Acceptance:** mesmas URLs/contratos OU front atualizado para as novas; webhooks continuam validando assinatura.

### P2: Deploy Hostinger Node + cutover
Pipeline de build/deploy para a hospedagem Node; domínio/subdomínio; desativar estático+PHP após validação.

### P3: Modernização opcional
Tailwind/shadcn, tipos gerados do Supabase em todo o app, testes E2E (Playwright) apontando para o app Node.

---

## Edge Cases / Riscos
- WHEN secrets ausentes no ambiente Node THEN build/boot falha cedo com erro claro (validação de env).
- WHEN sessão expira THEN middleware renova/expulsa sem loop de redirect.
- WHEN Hostinger não tiver Node no plano atual THEN bloqueia o deploy → **pré-requisito** confirmar VPS/Node App.
- WHEN realtime do chat (Supabase Realtime) THEN precisa funcionar client-side no Next (component cliente).
- WHEN cache LiteSpeed do site antigo THEN cutover por subdomínio evita conflito durante a transição.

---

## Requirement Traceability
| ID | Story | Fase | Status |
|---|---|---|---|
| MIG-00 | Scaffold + tooling + env + deploy base | Design | Pending |
| MIG-AUTH | Auth SSR + middleware + roles | Design | Pending |
| MIG-CSS | Design system portado | Design | Pending |
| MIG-PORTAL | Telas do cliente (paridade) | Design | Pending |
| MIG-ADMIN | Telas admin (paridade) | Design | Pending |
| MIG-API | Route Handlers (PHP→Node) | Design | Pending |
| MIG-DEPLOY | Hosting Node Hostinger + cutover | Design | Pending |

---

## Success Criteria
- [ ] Paridade funcional 100% validada (mesmos fluxos do atual) contra a Supabase de produção.
- [ ] Zero regressão visual perceptível.
- [ ] Secrets fora do client; PHP/`.htaccess`-SetEnv aposentados.
- [ ] Deploy de uma feature nova = editar componente + push (sem mirror de HTML).
