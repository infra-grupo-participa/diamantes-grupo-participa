# CLAUDE.md — diamantes-grupo-participa

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML/CSS/JS vanilla (sem bundler) |
| Backend | PHP 8.2 — arquivos em `api/` |
| Servidor | Hostinger (Apache + PHP shared hosting) |
| Dados | JSON em `api/storage/` e `api/data/` (migração para Supabase planejada na Fase 5) |
| Integrações | ClickUp API, Google Apps Script (Sheets), e-mail via `mail()` |
| CI/CD | GitHub Actions (`.github/workflows/`) |
| Testes | PHPUnit 11 (PHP) + Vitest (JS) + Playwright (E2E) |

## Fluxo obrigatório

```
feature branch → PR → CI obrigatório (6 checks) → aprovação → squash merge → deploy manual na Hostinger
```

**Nunca commite direto em `main` ou `homologacao`.** Veja `CONTRIBUTING.md` para detalhes.

## Quality Gate

O gate real fica no GitHub no momento do merge. Leia `docs/quality-gate.md` para:
- Lista dos 6 status checks obrigatórios
- Passos manuais de Branch Protection no GitHub
- Configuração de merge strategy (squash only)

Hooks locais (`lefthook.yml`) são opt-in e não substituem o CI.

## Como rodar local

**Pré-requisitos:** PHP 8.2+, Composer, Node 20+

```bash
# Clone e instala deps
composer install
npm install

# PHP built-in server (portal na porta 8080)
php -S 127.0.0.1:8080 -t .

# Ou com a porta que o Playwright usa (para E2E)
php -S 127.0.0.1:8765 -t .
```

## Como rodar testes

```bash
# PHPUnit (PHP)
composer test

# Vitest (JS unitário)
npm test

# Playwright (E2E, sobe PHP server sozinho)
npm run test:e2e

# E2E com browser visível (debug)
npm run test:e2e:headed
```

## Estrutura de arquivos relevantes

```
.
├── api/
│   ├── bootstrap.php      ← 1400+ linhas; core do sistema (Fase 2: extrair classes)
│   ├── auth.php           ← autenticação
│   ├── users.php          ← gestão de usuários
│   ├── clickup.php        ← integração ClickUp
│   ├── clickup-webhook.php← webhook ClickUp
│   ├── insights.php       ← relatórios
│   └── export.php         ← exportação de dados
├── admin/index.html       ← painel administrativo
├── {slug}/index.html      ← 27 portais individuais de clientes
├── index.html             ← tela de login
├── portal-auth.js         ← lógica de auth no cliente
├── portal-contracts.js    ← listagem de contratos
├── portal-insights.js     ← insights no cliente
├── auth-guard.js          ← guard de rota client-side
├── backend/server.py      ← listener Python ClickUp
├── chatbot/               ← bot Python WhatsApp
├── tests/
│   ├── Smoke/SanityTest.php  ← PHPUnit smoke
│   ├── unit/sanity.test.js   ← Vitest smoke
│   └── e2e/login.spec.js     ← Playwright smoke
├── .github/workflows/
│   ├── ci.yml             ← lint + testes + gitleaks + dependency review
│   ├── security.yml       ← varredura semanal
│   └── pr-quality.yml     ← comentário com métricas no PR
└── docs/quality-gate.md   ← como configurar o gate no GitHub
```

## Variáveis de ambiente

Veja `.env.example` para a lista completa. As principais:

| Variável | Descrição |
|----------|-----------|
| `GP_CLICKUP_API_KEY` | Token ClickUp |
| `GP_CLICKUP_WEBHOOK_SECRET` | Secret HMAC dos webhooks |
| `GP_SHEETS_SYNC_URL` | URL do Google Apps Script |
| `GP_SHEETS_SYNC_SECRET` | Secret do sync com Sheets |
| `GP_MAIL_FROM_EMAIL` | Remetente dos e-mails |
| `GP_APP_BASE_URL` | URL base da aplicação |

Legado: `api/data/clickup-api-key.txt` ainda é lido como fallback (remover na Fase 2).

## Roadmap de Fases

| Fase | Descrição | Status |
|------|-----------|--------|
| 0 | Quality Gate + Harness de Testes | Concluída |
| 1 | Segurança crítica: bcrypt, CSRF, rate-limit, CSP | Pendente |
| 2 | Quebrar `api/bootstrap.php` em classes PSR-4 (`src/`) | Pendente |
| 3 | Unificar 27 portais de clientes em portal único CRUD | Pendente |
| 4 | Modularizar `portal-insights.js` + extrair CSS inline | Pendente |
| 5 | Migrar armazenamento JSON → Supabase Postgres | Pendente |
| 6 | Deploy automatizado GitHub Actions → Hostinger | Pendente |

## Decisões tomadas (Fase 0)

- **PHP 8.2** no CI: versão em produção na Hostinger (conservador, não 8.3).
- **Apenas Chromium** no Playwright: mais rápido no CI. Firefox/WebKit na Fase 3+.
- **Thresholds de cobertura em 0%**: sobem por fase conforme `src/` cresce.
- **Squash merge obrigatório**: histórico linear, cada PR = 1 commit em `main`.
- **`dependency-review` só em PRs**: action não tem sentido em push direto.
- **`fail-on-severity: high`** no dependency-review: blocks high/critical vulns.
