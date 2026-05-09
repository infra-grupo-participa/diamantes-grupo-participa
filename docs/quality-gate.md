# Quality Gate — diamantes-grupo-participa

## Princípio fundamental

**O gate real fica no GitHub no momento do merge.**

Hooks locais (Lefthook/Husky) são opt-in para conveniência do desenvolvedor e podem ser bypassados com `--no-verify`. Eles não substituem branch protection. A consistência é garantida pelo CI + regras de branch no GitHub.

---

## Status Checks obrigatórios (configurar no GitHub)

Estes são os checks que devem estar marcados como **required** em Branch Protection:

| Check | Workflow | Job | Bloqueante |
|-------|----------|-----|-----------|
| PHP Lint (8.2) | `ci.yml` | `php-lint` | sim |
| PHPUnit | `ci.yml` | `phpunit` | sim |
| Vitest | `ci.yml` | `vitest` | sim |
| Playwright E2E | `ci.yml` | `playwright` | sim |
| Gitleaks | `ci.yml` | `gitleaks` | sim |
| Dependency Review | `ci.yml` | `dependency-review` | sim |
| **PHP lint + smoke** | `php-smoke.yml` | `smoke` | **sim — replica o padrão sip-system** |
| Post quality metrics comment | `pr-quality.yml` | `quality-comment` | informativo |

O `php-smoke.yml` sobe um `php -S` local e valida endpoint-por-endpoint do projeto (login page, `/api/health.php`, `/api/csrf.php`, `/api/auth.php`, `/api/users.php`, `/api/clickup.php`, `/api/clickup-webhook.php`, `/portal/?slug=`). Replicado do `sistema-grupo-participa` (sip-system).

---

## Configuração de Branch Protection (passos manuais no GitHub)

1. Acesse: **Settings → Branches → Add branch protection rule**
2. Branch name pattern: `main`
3. Marque:
   - [x] **Require a pull request before merging**
     - [x] Require approvals: `1`
     - [x] Dismiss stale pull request approvals when new commits are pushed
   - [x] **Require status checks to pass before merging**
     - [x] Require branches to be up to date before merging
     - Adicione os 6 checks da tabela acima em "Status checks that are required"
   - [x] **Require linear history** (força squash ou rebase — sem merge commits)
   - [x] **Do not allow bypassing the above settings** (inclui admins)
   - [x] **Restrict who can push to matching branches** (opcional, mas recomendado)
4. Repita para a branch `homologacao` com as mesmas regras (exceto `Require approvals` que pode ser 0)

**Merge strategy:** Squash merge obrigatório. Configure em **Settings → General → Pull Requests**:
- [x] Allow squash merging
- [ ] Allow merge commits (desmarque)
- [ ] Allow rebase merging (desmarque)

---

## Hooks locais (opt-in)

O arquivo `lefthook.yml` na raiz oferece hooks de conveniência:

- **pre-commit:** `php -l` nos arquivos PHP staged + Gitleaks nos staged
- **commit-msg:** valida Conventional Commits (regex inline, sem Node)

Para instalar: `npx lefthook install`
Para desinstalar: `npx lefthook uninstall`

**Estes hooks não substituem o CI.** Um push direto sem passar pelo hook local ainda é bloqueado pelos checks obrigatórios no GitHub.

---

## Varredura de segurança semanal

O workflow `security.yml` roda toda segunda-feira às 6h UTC e pode ser disparado manualmente. Executa:

- Gitleaks no histórico completo
- `npm audit --audit-level=high`
- `composer audit`

---

## Relatório de qualidade por PR

O workflow `pr-quality.yml` posta (e atualiza a cada push) um comentário no PR com:

- Contagem de erros PHP lint
- Cobertura PHPUnit (statements cobertos / total)
- Cobertura Vitest (linhas cobertas / total)
- Diff stats (arquivos, linhas adicionadas/removidas)
