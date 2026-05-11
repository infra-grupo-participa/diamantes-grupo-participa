# CLAUDE.md — diamantes-grupo-participa

Portal cliente do programa Diamantes (Grupo Participa).
Hospedado em **https://diamantes.grupoparticipa.app.br/** (Hostinger / LiteSpeed).

## Stack

- **Frontend:** HTML/JS vanilla (sem bundler). Inter font, palette laranja
  Diamantes (`#F29725`), 2 áreas distintas:
  - `/` → login
  - `/admin/` → painel interno (funcionários, alunos, assinaturas)
  - `/portal/dashboard.html?slug=X` → portal do cliente (`/{slug}/` redireciona pra cá)
- **Backend:** Supabase (Auth + Postgres + Storage + RLS). Schema `portal`.
  Pequena camada PHP em `api/clickup.php` proxy autenticado pro ClickUp.
- **Deploy:** GitHub Actions → FTP da Hostinger via self-hosted Windows runner.

## Estrutura

```
.
├── index.html                  ← login (Supabase Auth)
├── auth-guard.js               ← guard client-side
├── .htaccess                   ← redirects e CSP (regenerado no deploy-prod.yml)
├── assets/js/
│   ├── supabase-config.js      ← cliente Supabase (anon key + schema portal)
│   ├── supabase-i18n.js        ← tradução de erros
│   └── portal-auth-v2.js       ← lib de login (cliente + admin)
├── admin/                      ← painel interno
│   ├── index.html              ← Funcionários
│   ├── alunos-diamantes.html   ← Alunos Diamantes + atribuição de equipe
│   ├── assinaturas.html        ← Assinaturas (MRR, status, vencimentos)
│   ├── .htaccess               ← desabilita cache LiteSpeed (dev)
│   └── assets/admin-api.js     ← wrapper sobre supabase-js (admin)
├── portal/                     ← portal do cliente
│   ├── index.html              ← bridge: redireciona pra dashboard.html?slug=X
│   ├── dashboard.html          ← tela inicial do cliente
│   ├── demandas.html           ← lista + chat + detalhes (visual; lógica em D)
│   ├── perfil.html             ← Meus dados (CRUD em portal.users + prefs)
│   └── assets/portal-api.js    ← wrapper sobre supabase-js (cliente)
├── api/
│   ├── clickup.php             ← proxy ClickUp (para Etapa D)
│   └── clickup-webhook.php     ← webhook ClickUp
├── tests/                      ← Playwright + Vitest
├── docs/                       ← runbooks e auditorias
├── scripts/                    ← quality gate
└── .github/workflows/
    ├── deploy-prod.yml         ← FTP deploy (self-hosted Windows)
    ├── quality-gate.yml        ← lint + jscpd + gitleaks
    └── update-baseline.yml     ← atualiza .quality-baseline.json
```

## Fluxo de autenticação

1. Cliente abre `/` → faz login (Supabase Auth via `signInWithPassword`).
2. `portal-auth-v2.js` busca `portal.users WHERE auth_user_id = auth.uid()`.
3. Se `role='admin'` → redireciona pra `/admin/`.
4. Se `role='user'` e `status='approved'` → redireciona pra `/portal/dashboard.html?slug={client_slug}`.
5. RLS no Postgres + `requireClient` / `requireAdmin` no front protegem cada página.

## Schemas (resumo)

- `portal.users` — perfis (admin, operator, user) com `client_slug` para clientes.
- `portal.positions` — cargos editáveis (5 cargos: Editor de Vídeo, Gestor de tráfego, Social Media, Web-Designer, Designer, Automação).
- `portal.clients` — alunos Diamantes (slug, display_name, cu_list_id).
- `portal.client_profiles` — JSON com billing/contract/seminário.
- `portal.services` — serviços contratados (1 row por cliente × tipo).
- `portal.team_assignments` — operador ↔ aluno ↔ cargo.
- `portal.subscriptions` — assinaturas mensais (plano, valor, status, próxima cobrança).
- `portal.user_preferences` — notificações, idioma, fuso, tema.
- `portal.ratings` — avaliações de tasks (1-10, depois /2 para 0-5).
- `portal.audit_log` — log de eventos.
- Views: `v_employees`, `v_students`, `v_subscriptions`.
- RPCs: `get_student_team(slug)`, `get_my_dashboard()`, `delete_employee(id)`.
- RLS habilitada em todas as tabelas; função helper `portal.is_admin()`.

## Deploy

- **FTP gotcha (resolvido):** o user FTP da Hostinger entra dentro de `public_html/`.
  `deploy-prod.yml` detecta isso automaticamente em runtime. **Não usar** o
  secret `HOSTINGER_FTP_PATH` no upload — está só para retro-compat.
- **Cache LiteSpeed agressivo:** purgar manualmente no hPanel quando algo
  ficar "preso".
- **Self-hosted runner em Windows** está em `C:\Users\infra\actions-runner` —
  o runner precisa estar online para o deploy.

## Quality Gate

Roda no self-hosted (GH Actions hosted está bloqueado por billing).
Baseline em `.quality-baseline.json` — auto-recalibra em push pra main via
`update-baseline.yml`.
