# Deploy Runbook — diamantes-grupo-participa

## Visão geral

O deploy é automatizado via GitHub Actions:

- `push` em `main` → dispara `deploy-prod.yml` → produção (`diamantes.grupoparticipa.app.br`)
- `push` em `homologacao` → dispara `deploy-homolog.yml` → homolog (`homolog.diamantes.grupoparticipa.app.br`)

O fluxo completo em produção é:

```
feat/* → PR → CI verde (6 checks) → squash merge → deploy automático via main → smoke test → done
```

Deploys nunca se cancelam mutuamente: se um deploy está em curso e outro é disparado, o segundo aguarda na fila (`cancel-in-progress: false`).

---

## Secrets a cadastrar no GitHub

Acesse: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

### Produção

| Secret | Descrição | Como obter |
|--------|-----------|------------|
| `HOSTINGER_FTP_HOST` | Host FTP da Hostinger | Painel Hostinger → Hospedagem → Gerenciar → FTP |
| `HOSTINGER_FTP_USER` | Usuário FTP | Mesmo painel, aba FTP |
| `HOSTINGER_FTP_PASSWORD` | Senha FTP | Mesmo painel — redefina se não souber |
| `HOSTINGER_FTP_PATH` | Caminho no servidor | Ex: `/public_html/diamantes/` (verifique estrutura de pastas no File Manager) |
| `GP_SUPABASE_URL` | URL do projeto Supabase | Supabase → Project Settings → API → Project URL |
| `GP_SUPABASE_SERVICE_ROLE_KEY` | Service role key do Supabase | Supabase → Project Settings → API → service_role (nunca expor no client) |
| `GP_CLICKUP_API_KEY` | Token pessoal ClickUp | ClickUp → Settings → Apps → API Token |
| `GP_CLICKUP_WEBHOOK_SECRET` | Secret HMAC dos webhooks ClickUp | Definido por você ao criar o webhook no ClickUp |
| `GP_SHEETS_SYNC_URL` | URL do Google Apps Script | URL de publicação do script de sincronização |
| `GP_SHEETS_SYNC_SECRET` | Secret do sync com Sheets | Definido no script do Apps Script |
| `GP_BOOTSTRAP_ADMIN_EMAIL` | E-mail do admin inicial | Seu e-mail de administrador |
| `GP_BOOTSTRAP_ADMIN_PASSWORD` | Senha do admin inicial | Senha forte, armazenada só aqui |
| `GP_DEPLOY_PAUSED` | Opcional — pause o deploy | Defina `true` para bloquear; remova para retomar |

### Homologação

As mesmas secrets acima, prefixadas com `HOSTINGER_HOMOLOG_` para as FTP:

| Secret | Descrição |
|--------|-----------|
| `HOSTINGER_HOMOLOG_FTP_HOST` | Host FTP do ambiente de homolog |
| `HOSTINGER_HOMOLOG_FTP_USER` | Usuário FTP de homolog |
| `HOSTINGER_HOMOLOG_FTP_PASSWORD` | Senha FTP de homolog |
| `HOSTINGER_HOMOLOG_FTP_PATH` | Caminho no servidor homolog (ex: `/public_html/homolog-diamantes/`) |

As secrets `GP_*` são compartilhadas entre prod e homolog (o workflow lê as mesmas). Se quiser ambientes Supabase separados, crie variantes `_HOMOLOG` e ajuste o workflow.

---

## Primeiro deploy

1. Cadastre todas as secrets listadas acima.
2. Crie os environments no GitHub (opcional mas recomendado para proteção extra):
   - **GitHub → Settings → Environments → New environment**
   - Crie `production` e `homologacao`
   - Em `production`, habilite "Required reviewers" se quiser aprovação manual
3. Faça um `push` em `main` (ou dispare manualmente via **Actions → Deploy — Produção → Run workflow**).
4. Acompanhe em **Actions** — o pipeline tem 4 jobs: `validate-secrets → build → deploy → smoke`.
5. Após smoke test verde, acesse `https://diamantes.grupoparticipa.app.br` para confirmar.

---

## Opção SSH em vez de FTP (recomendado para Hostinger Business+)

Se sua hospedagem suportar SSH/SFTP:

```bash
# Gerar chave dedicada para deploy
ssh-keygen -t ed25519 -C "github-deploy@diamantes" -f ~/.ssh/diamantes_deploy -N ""

# Exibir chave pública para colar no Hostinger
cat ~/.ssh/diamantes_deploy.pub
```

No Hostinger: **Hospedagem → Gerenciar → SSH Access → Authorized Keys** → cole a chave pública.

No GitHub, substitua `HOSTINGER_FTP_PASSWORD` por `HOSTINGER_SSH_PRIVATE_KEY` (conteúdo de `diamantes_deploy`) e troque a action FTP por uma action rsync/SSH (ex: `burnett01/rsync-deployments`).

A chave privada (`~/.ssh/diamantes_deploy`) fica APENAS na sua máquina e como secret no GitHub. Nunca comite.

---

## Rotação de credenciais

**Quando rotar:**
- Saída de um colaborador
- Suspeita de vazamento
- Ciclo de rotação periódica (recomendado: 90 dias para FTP/Supabase)

**Como rotar:**

1. Gere a nova credencial na origem (Hostinger, Supabase, ClickUp).
2. No GitHub: **Settings → Secrets → clique na secret → Update** — cole o novo valor.
3. Dispare um deploy manual para validar: **Actions → Deploy — Produção → Run workflow**.
4. Após smoke test verde, invalide/remova a credencial antiga na origem.
5. Documente a rotação no log interno (data, responsável, motivo).

Nunca commite credenciais. Nunca as coloque em `echo` ou `run:` sem mascaramento. O GitHub mascara automaticamente secrets declaradas em `env:`.

---

## Rollback

### Opção 1 — Re-run de deploy anterior (mais rápido)

1. GitHub → **Actions → Deploy — Produção**
2. Encontre o último deploy bem-sucedido (ícone verde)
3. Clique → **Re-run all jobs**
4. O artifact daquele commit é re-deploiado sem recompilar

### Opção 2 — Revert de commit + push

```bash
# Identifica o commit alvo
git log --oneline main

# Cria commit de revert
git revert <commit-sha> --no-edit

# Push para main dispara novo deploy automaticamente
git push origin main
```

### Opção 3 — Checkout + push forçado de commit alvo

```bash
# Apenas se as opções acima falharem — requer permissão de admin no repo
git checkout <commit-sha>
git checkout -b hotfix/rollback-to-<sha>
# Abra PR para main
```

---

## Smoke test manual

```bash
# Verifica se /api/csrf.php responde 200
curl -v https://diamantes.grupoparticipa.app.br/api/csrf.php

# Verifica login page
curl -s -o /dev/null -w "%{http_code}" https://diamantes.grupoparticipa.app.br/

# Verifica portal (autenticado — precisa de cookie de sessão)
curl -s -b "session=..." https://diamantes.grupoparticipa.app.br/portal/?slug=exemplo
```

---

## Pausar deploys

### Via secret (recomendado — não exige acesso ao código)

1. GitHub → **Settings → Secrets → New repository secret**
2. Nome: `GP_DEPLOY_PAUSED`, valor: `true`
3. Qualquer push para `main` ou `homologacao` falhará no job `deploy` com aviso claro.
4. Para retomar: delete a secret ou mude para `false`.

### Via GitHub UI

1. GitHub → **Actions → Deploy — Produção** (ou Homologação)
2. Clique no menu de 3 pontos → **Disable workflow**
3. Para reativar: mesmo menu → **Enable workflow**

---

## Estrutura do artifact

O que sobe para a Hostinger é tudo do repositório **exceto** o que está listado em `.deployignore`:

- `api/` — PHP backend
- `src/` — classes PSR-4
- `portal/` — endpoint PHP unificado
- `admin/` — painel administrativo
- `vendor/` — dependências Composer (sem `vendor/bin/`)
- `*.html` raiz — login e portais legados
- `*.js` raiz — módulos client-side
- `.htaccess` — regras Apache

Não sobem: `node_modules/`, `tests/`, `docs/`, `tmp/`, `.github/`, configs de dev.

---

## Ambientes GitHub

Para proteção adicional em produção, configure o environment `production` com:
- **Required reviewers**: João (aprovação manual antes do deploy em prod)
- **Wait timer**: 0 min (ou 5 min para cooling-off period)
- **Deployment branches**: apenas `main`

Isso adiciona um "portão" entre o job `build` e o job `deploy`.
