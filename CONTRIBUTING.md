# Guia de Contribuição

## Branch strategy

- Todo trabalho novo acontece em **feature branches** criadas a partir de `main`.
- **Nunca commite diretamente em `main` ou `homologacao`.**
- Nomenclatura sugerida: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `ci/<slug>`.
- Um PR por feature/fix. Squash merge ao mesclar.

## Conventional Commits

Formato: `<tipo>(<escopo>): <descrição imperativa curta>`

**Tipos:**

| Tipo | Quando usar |
|------|-------------|
| `feat` | Nova funcionalidade para o usuário |
| `fix` | Correção de bug |
| `refactor` | Mudança de código sem alterar comportamento |
| `chore` | Tarefas de manutenção (atualizar deps, configs) |
| `docs` | Apenas documentação |
| `test` | Adição ou ajuste de testes |
| `ci` | Mudanças em workflows, GitHub Actions |
| `perf` | Melhoria de performance |
| `style` | Formatação, espaços, ponto-e-vírgula (sem lógica) |
| `build` | Mudanças no sistema de build (composer, npm) |

**Escopos:**

`api` | `admin` | `portal` | `chatbot` | `backend` | `infra` | `deps` | `docs`

**Exemplos:**

```
feat(portal): adiciona modal de confirmação de logout
fix(api): corrige vazamento de sessão no endpoint de auth
chore(deps): atualiza phpunit para 11.2
ci: adiciona job de dependency review
docs: atualiza guia de quality gate
test(api): adiciona cobertura para gp_normalize_user
```

**Breaking changes:** adicione `!` após o tipo/escopo e descreva no corpo:

```
feat(api)!: remove suporte a autenticação por CPF

BREAKING CHANGE: clientes precisam usar e-mail para login.
```

## Fluxo de PR

1. Crie a branch: `git checkout -b feat/minha-feature`
2. Desenvolva com commits atômicos e convencionais
3. Rode os testes localmente (veja abaixo)
4. Abra o PR contra `main` usando o template
5. Aguarde o CI passar (todos os 6 checks obrigatórios)
6. Aguarde aprovação de 1 revisor
7. Squash merge

## Como rodar testes localmente

### PHP

```bash
# Instalar dependências (primeira vez)
composer install

# Rodar suite completa
composer test

# Lint em todos os .php
composer lint
```

### JavaScript (Vitest)

```bash
# Instalar dependências (primeira vez)
npm install

# Rodar testes unit
npm test

# Modo watch (desenvolvimento)
npm run test:watch
```

### E2E (Playwright)

```bash
# Instalar browsers (primeira vez)
npx playwright install chromium

# Rodar E2E (sobe PHP server automaticamente)
npm run test:e2e

# Com browser visível (debug)
npm run test:e2e:headed
```

## Hooks locais (opt-in)

O projeto inclui `lefthook.yml` com hooks de conveniência (php lint + gitleaks no pre-commit, Conventional Commits no commit-msg). São opcionais — o gate real é o CI.

```bash
npx lefthook install    # ativa
npx lefthook uninstall  # desativa
```

## Não faça

- Commitar `.env` com valores reais
- Commitar em `main` ou `homologacao` diretamente
- Editar arquivos em `api/`, `admin/`, `backend/`, `chatbot/` sem abrir PR
- Usar `--no-verify` para pular hooks locais em código que vai pro PR
