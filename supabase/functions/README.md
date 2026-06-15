# Edge Functions (Supabase) — integração ClickUp

A integração com o ClickUp **NÃO** roda nas rotas Next.js do app. Ela é feita por
**Supabase Edge Functions + triggers no banco + segredos no Vault**. Estes arquivos
são a **cópia versionada** das funções que vivem no projeto Supabase
`npqyvjhvtfahuxfmuhie` — a fonte da verdade é o deploy lá (`supabase functions deploy`).
Mantenha este diretório em sincronia ao editar uma função.

## Por que Edge Functions (e não Next.js)
- Co-localizadas com o Postgres (sa-east-1) → baixa latência nas muitas queries de sync.
- Saída dirigida por trigger no banco (dispara em qualquer mudança de demanda/mensagem),
  desacoplada do request do usuário.
- Webhook em infra Supabase (auto-scaling) é mais confiável que o Node App da Hostinger
  (o webhook legado em PHP, na Hostinger, foi suspenso pelo ClickUp após 100 falhas).

## Fluxos

### Saída — portal → ClickUp
- `clickup-sync` — cria/atualiza a **task** da demanda (assignees por `clickup_user_id`,
  custom fields cliente/solicitante/equipe, status PT-BR) e grava `demands.clickup_task_id`.
  - Disparada por: trigger `demands_clickup_insert` / `demands_clickup_update` em
    `portal.demands` → `portal._sync_demand_to_clickup` (pg_net).
  - **Lista por cliente:** a task vai pra **lista do cliente** (`clients.cu_list_id`)
    p/ organizar por aluno no operacional; sem `cu_list_id`, cai na lista global
    (`clickup_config.list_id`).
  - **Prefixo de projeto:** o nome da task vira `[<Projeto>] <título>` quando a demanda
    tem `project_id` (diferencia o projeto no ClickUp). O `clickup-webhook` remove esse
    prefixo (`^\[...\]`) ao sincronizar o nome de volta — não polui `demands.title`.
  - **Single-assignee:** se o espaço do ClickUp não tem o ClickApp de múltiplos
    assignees (erro `ITEM_417`), a task é (re)criada com **1 responsável** (o 1º operador);
    a equipe completa fica no custom field "equipe".
- `clickup-comment-sync` — publica a **mensagem** do chat como comentário na task.
  - Disparada por: trigger `messages_clickup_sync` em `portal.demand_messages` →
    `portal._sync_message_to_clickup` (pg_net). Ignora mensagens com `origin='clickup'`
    (evita eco).

### Entrada — ClickUp → portal
- `clickup-webhook` — recebe o webhook (HMAC-SHA256 com `clickup_webhook_secret`),
  mapeia status reverso (aberta→open…), título/descrição/datas, `taskDeleted`→canceled,
  e sincroniza comentários novos para `portal.demand_messages` (com dedup por
  `clickup_comment_id`).
  - Webhook registrado no ClickUp aponta para `…/functions/v1/clickup-webhook`.

## Segredos (Supabase Vault, lidos via `portal.get_internal_secret`)
- `clickup_api_key` — token da API do ClickUp (`pk_…`).
- `clickup_webhook_secret` — segredo HMAC do webhook.
- `clickup_sync_internal_key` — chave interna que as triggers usam para chamar as
  funções de saída (`x-internal-key`).

## Config (tabela `portal.clickup_config`)
`list_id`, `team_id`, `space_id`, `webhook_id` e os IDs dos custom fields
(`field_cliente_slug`, `field_solicitante`, `field_demand_id`, `field_equipe`).

## Exceção: briefing → ClickUp
O anexo do **PDF do briefing** ainda é feito pela rota Next.js
`app/api/briefing-to-clickup` (usa `process.env.CLICKUP_TOKEN` no Hostinger), pois cria
uma task de briefing com upload de arquivo. Candidata a virar Edge Function no futuro.
Enquanto isso, **`CLICKUP_TOKEN` precisa estar setado no Node App da Hostinger** só por
causa dessa rota.

## E-mails transacionais (Resend) — `send-email`
Mesmo padrão (trigger → pg_net → Edge Function → API externa), agora para **e-mail**.

- **`send-email`** — recebe `{ type, ... }`, monta o HTML estilizado (cores da marca,
  `app/globals.css`) e envia via **Resend**. É **provider-agnóstico**: trocar de provedor
  mexe só em `sendViaProvider()` + no secret. `verify_jwt=false` (auth por `x-internal-key`).
  - `type:'demanda_criada'` (`demand_id`) → confirmação ao cliente. Dedup *uma vez só* por
    `dedup_key = demanda_criada:<id>`.
  - `type:'projeto_criado'` (`project_id`) → avisa o cliente que o projeto foi criado e que
    falta o briefing. Dedup *uma vez só* por `dedup_key = projeto_criado:<id>`.
  - `type:'custom'` (`to,subject,html`) → envio manual/teste.
  - **Nova mensagem NÃO dispara e-mail** (o ClickUp já notifica). **Reset de senha** é via
    SMTP do Supabase Auth, fora desta EF.
- **Triggers:** `demands_email_notify` em `portal.demands` (`_notify_demanda_criada`) e
  `projects_email_notify` em `portal.projects` (`_notify_projeto_criado`).
- **Auditoria/dedup:** tabela `portal.email_log` (status `sent|failed|skipped`, `resend_id`,
  `dedup_key`, `ref_type/ref_id`). RLS: SELECT só admin.
- **Secret:** `resend_api_key` no Vault (whitelist em `portal.get_internal_secret`).
- **Remetente:** `nao-responder@diamantes.grupoparticipa.app.br` (domínio verificado no Resend).

### Reset de senha seguro (Supabase Auth)
O reset agora usa **link por e-mail** (`auth.resetPasswordForEmail` → `/auth/callback`
troca o `code` por sessão → `/reset-password/update`). A rota insegura `app/api/reset-password`
foi removida. **Requer SMTP custom (Resend) no Supabase Auth** para o envio do link —
ver instruções no painel (Authentication → SMTP) e o redirect `…/auth/callback` na allowlist.

## Outras Edge Functions ativas (não versionadas aqui)
`digisac-webhook`, `admin-digisac-lookup` (integração Digisac/WhatsApp),
`cron-expirar-sessoes`, `cron-expirar-avaliacoes` (crons). Exportar quando for mexer.
