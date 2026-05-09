# Runbook: JSON → Supabase Migration (Fase 5)

## Visão Geral

A Fase 5 introduz suporte a Supabase Postgres como backend de armazenamento,
substituindo progressivamente os arquivos JSON em `api/storage/`.

A migração é **zero-downtime** via `DualWriteStorageDriver` (dual-write).

---

## Drivers disponíveis (`GP_STORAGE_DRIVER`)

| Valor | Comportamento |
|-------|--------------|
| `json` | JSON flat-file em `api/storage/` (padrão, Fases 1-4) |
| `supabase` | PostgREST Supabase exclusivo |
| `dual` | Escreve em ambos; lê do JSON (migração gradual) |

---

## Por que PostgREST em vez de PDO pgsql?

Hostinger shared hosting não habilita `pdo_pgsql` por padrão. PostgREST é
acessado via HTTPS usando apenas curl (sempre disponível), sem necessidade de
extensão PHP adicional. É também mais portável para qualquer host compartilhado.

---

## Pré-requisitos

1. Supabase project `gfynspfdkhtjrsboceka` já criado.
2. Tabelas `clients`, `users`, `audit_log` criadas via migration MCP.
3. Variáveis de ambiente configuradas:

```bash
GP_SUPABASE_URL=https://gfynspfdkhtjrsboceka.supabase.co
GP_SUPABASE_SERVICE_ROLE_KEY=<service_role_key_do_supabase>
```

> **Segurança:** `GP_SUPABASE_SERVICE_ROLE_KEY` NUNCA deve aparecer em
> variáveis públicas do frontend, logs, ou commits. PHP backend only.

---

## Passo a passo

### Fase A: Dry-run (sem mudanças)

```bash
# Preview completo de tudo que seria migrado
php api/scripts/migrate-all-to-supabase.php --dry-run
```

### Fase B: Migração real (uma vez, em manutenção)

```bash
# Migrar portais (clients)
php api/scripts/migrate-clients-to-supabase.php

# Migrar usuários (mantém bcrypt hashes)
php api/scripts/migrate-users-to-supabase.php

# Migrar audit log
php api/scripts/migrate-audit-log-to-supabase.php

# Ou tudo de uma vez com confirmação explícita:
GP_MIGRATION_CONFIRM=yes php api/scripts/migrate-all-to-supabase.php
```

Scripts são **idempotentes** — podem ser re-executados sem duplicar dados.

### Fase C: Ativar dual-write (shadow mode)

```bash
# .env em produção
GP_STORAGE_DRIVER=dual
```

Monitore `error_log` por mensagens de `[DualWriteStorageDriver]`. Erros na
secondary são logados mas não afetam a produção.

### Fase D: Validar paridade dos dados

```bash
# Compare contagem de usuários
# JSON:
cat api/storage/app-state.json | python -c "import json,sys; d=json.load(sys.stdin); print(len(d['users']))"

# Supabase (via Dashboard ou API):
curl -s "$GP_SUPABASE_URL/rest/v1/users?select=count" \
  -H "apikey: $GP_SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $GP_SUPABASE_SERVICE_ROLE_KEY" \
  -H "Prefer: count=exact" -I | grep content-range
```

### Fase E: Cortar para Supabase exclusivo

```bash
# .env em produção
GP_STORAGE_DRIVER=supabase
GP_PORTALS_SOURCE=supabase
```

Manter `api/storage/app-state.json` como backup por 30 dias antes de remover.

---

## Variáveis de ambiente completas

```ini
# Driver de storage
GP_STORAGE_DRIVER=json

# Supabase
GP_SUPABASE_URL=https://gfynspfdkhtjrsboceka.supabase.co
GP_SUPABASE_SERVICE_ROLE_KEY=

# Fonte dos portais
GP_PORTALS_SOURCE=json

# Confirmar migração (somente ao rodar os scripts de migração)
GP_MIGRATION_CONFIRM=
```

---

## Rollback

Para reverter do Supabase para JSON:

```bash
GP_STORAGE_DRIVER=json
GP_PORTALS_SOURCE=json
```

Não é necessária nenhuma outra mudança — o JSON em `api/storage/` permanece
como fonte da verdade durante todo o período dual-write.

---

## Testes

```bash
# Unitários (sem Supabase real)
vendor/bin/phpunit --filter Storage

# Integração (requer credenciais)
GP_SUPABASE_URL=... GP_SUPABASE_SERVICE_ROLE_KEY=... vendor/bin/phpunit tests/Integration/
```
