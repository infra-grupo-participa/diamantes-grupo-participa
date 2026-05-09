# CLAUDE.md — diamantes-grupo-participa

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML/CSS/JS vanilla (sem bundler) |
| Backend | PHP 8.2 — arquivos em `api/` |
| Servidor | Hostinger (Apache + PHP shared hosting) |
| Dados | JSON em `api/storage/` (padrão) + Supabase Postgres (Fase 5, opt-in via `GP_STORAGE_DRIVER`) |
| Integrações | ClickUp API, Google Apps Script (Sheets), e-mail via `mail()` |
| CI/CD | GitHub Actions (`.github/workflows/`) |
| Testes | PHPUnit 11 (PHP) + Vitest (JS) + Playwright (E2E) |

## Fluxo obrigatório

```
feat/* → PR → CI verde (6 checks) → aprovação → squash merge → deploy automático via main → smoke test → done
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
│   ├── bootstrap.php      ← core do sistema; wrappers para classes PSR-4 em src/
│   ├── auth.php           ← autenticação
│   ├── users.php          ← gestão de usuários
│   ├── clickup.php        ← integração ClickUp
│   ├── clickup-webhook.php← webhook ClickUp
│   ├── insights.php       ← relatórios
│   ├── export.php         ← exportação de dados
│   ├── data/
│   │   └── portals.json   ← config dos 27 portais (cf_tipos, assignee_ids, auto_map)
│   └── scripts/
│       ├── setup-admin.php                    ← cria/atualiza admin
│       ├── seed-client-slugs.php              ← idempotente: atribui clientSlug a users
│       ├── migrate-clients-to-supabase.php    ← Fase 5: portals.json → Supabase clients
│       ├── migrate-users-to-supabase.php      ← Fase 5: app-state.json → Supabase users
│       ├── migrate-audit-log-to-supabase.php  ← Fase 5: audit-log.jsonl → Supabase
│       └── migrate-all-to-supabase.php        ← Fase 5: orchestrador (GP_MIGRATION_CONFIRM=yes)
├── portal/
│   ├── index.php          ← endpoint único: auth guard + render por slug
│   └── template.html      ← template com {{PLACEHOLDERS}} extraído do portal canônico
├── src/                   ← classes PSR-4 (Fase 2+)
│   ├── Container.php      ← factory/registry; Container::storage() retorna StorageDriver
│   ├── Storage/
│   │   ├── StorageDriver.php          ← interface (Fase 5)
│   │   ├── StorageException.php       ← erro tipado do driver
│   │   ├── StateRepository.php        ← JSON flat-file (Fase 2)
│   │   ├── JsonStateDriver.php        ← adapta StateRepository p/ StorageDriver (Fase 5)
│   │   ├── SupabaseStateRepository.php← PostgREST Supabase (Fase 5)
│   │   └── DualWriteStorageDriver.php ← fan-out primary+secondary (Fase 5)
│   └── Users/UserService.php  ← normalize() já inclui clientSlug
├── admin/index.html       ← painel administrativo
├── {slug}/index.html      ← 27 portais legados (coexistem até PR 3b removê-los)
├── index.html             ← tela de login
├── portal-auth.js         ← lógica de auth; getClientUrl() aponta para /portal/?slug=
├── portal-contracts.js    ← listagem de contratos
├── portal-insights.js     ← insights no cliente
├── auth-guard.js          ← guard de rota client-side
├── backend/server.py      ← listener Python ClickUp
├── chatbot/               ← bot Python WhatsApp
├── tests/
│   ├── Smoke/SanityTest.php              ← PHPUnit smoke
│   ├── Unit/Portal/AuthorizationTest.php ← PHPUnit: auth guard do portal
│   ├── unit/sanity.test.js               ← Vitest smoke
│   ├── e2e/login.spec.js                 ← Playwright smoke
│   └── e2e/portal-unification.spec.js    ← Playwright: snapshot 27 slugs + IDOR
├── .htaccess              ← redirects legados /{slug}/ → /portal/?slug=
├── .github/workflows/
│   ├── ci.yml             ← lint + testes + gitleaks + dependency review
│   ├── security.yml       ← varredura semanal
│   └── pr-quality.yml     ← comentário com métricas no PR
├── docs/quality-gate.md   ← como configurar o gate no GitHub
├── docs/migration-supabase.md ← runbook Fase 5: JSON → Supabase
└── docs/deploy.md         ← runbook de deploy: secrets, rollback, smoke test, rotação de creds
```

## Fluxo de request — Portal (Fase 3)

```
Cliente → GET /portal/?slug=X
       → portal/index.php
         - gp_get_session_user() → 401 se sem sessão
         - Valida slug (regex /^[a-z][a-z0-9-]+$/) → 400 se inválido
         - Admin: acessa qualquer slug
         - Client: só seu próprio clientSlug → 403 se diferente
         - Lê api/data/portals.json → 404 se slug não existe
         - Renderiza portal/template.html via strtr() com dados do portal
       → HTML idêntico ao legado /{slug}/index.html
```

### Variáveis de configuração por portal (portals.json)

| Campo | Descrição |
|-------|-----------|
| `slug` | Identificador único (ex: `joao-eduardo-zanela`) |
| `display_name` | Nome exibido no title e h1 |
| `cliente_name_var` | Nome em maiúsculas para JS |
| `cliente_task_id` | ID da task no ClickUp |
| `cf_tipos` | Lista de tipos de serviço disponíveis |
| `assignee_ids` | Mapa nome → ID no ClickUp |
| `auto_map` | Mapa tipo → nome do prestador padrão |

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
| `GP_STORAGE_DRIVER` | `json` (padrão) \| `supabase` \| `dual` |
| `GP_SUPABASE_URL` | URL do projeto Supabase |
| `GP_SUPABASE_SERVICE_ROLE_KEY` | Service role key (NUNCA expor ao frontend) |
| `GP_PORTALS_SOURCE` | `json` (padrão) \| `supabase` — fonte dos portais em `portal/index.php` |

Legado: `api/data/clickup-api-key.txt` ainda é lido como fallback (remover na Fase 2).

## Supabase (Fase 5)

- **Project ref:** `gfynspfdkhtjrsboceka` — região `sa-east-1`
- **Tabelas:** `clients`, `users`, `audit_log` (+ `services`, `ratings`, `task_reviews`, `client_profiles`, `rate_limits`)
- **RLS:** habilitada em todas as tabelas. Service role bypassa RLS.
- **Transport:** PostgREST (REST API via curl) — não requer extensão PHP pgsql.
- **Runbook de migração:** `docs/migration-supabase.md`

### Fluxo de migração recomendado

1. `GP_STORAGE_DRIVER=dual` → dual-write (JSON primário + Supabase shadow)
2. Monitorar logs por erros do `[DualWriteStorageDriver]`
3. Validar paridade de dados entre JSON e Supabase
4. `GP_STORAGE_DRIVER=supabase` + `GP_PORTALS_SOURCE=supabase` → corte completo

## Roadmap de Fases

| Fase | Descrição | Status |
|------|-----------|--------|
| 0 | Quality Gate + Harness de Testes | Concluída |
| 1 | Segurança crítica: bcrypt, CSRF, rate-limit, CSP | Pendente |
| 2 | Quebrar `api/bootstrap.php` em classes PSR-4 (`src/`) | Pendente |
| 3 | Unificar 27 portais de clientes em portal único CRUD | PR 3a concluído — portais legados coexistindo |
| 4 | Modularizar `portal-insights.js` + extrair CSS inline | Pendente |
| 5 | Migrar armazenamento JSON → Supabase Postgres | Concluída |
| 6 | Deploy automatizado GitHub Actions → Hostinger | Pendente — workflows entregues, aguarda cadastro de secrets + primeiro deploy manual |

## Decisões tomadas (Fase 0)

- **PHP 8.2** no CI: versão em produção na Hostinger (conservador, não 8.3).
- **Apenas Chromium** no Playwright: mais rápido no CI. Firefox/WebKit na Fase 3+.
- **Thresholds de cobertura em 0%**: sobem por fase conforme `src/` cresce.
- **Squash merge obrigatório**: histórico linear, cada PR = 1 commit em `main`.
- **`dependency-review` só em PRs**: action não tem sentido em push direto.
- **`fail-on-severity: high`** no dependency-review: blocks high/critical vulns.
