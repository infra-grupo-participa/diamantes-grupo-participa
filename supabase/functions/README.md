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

## Outras Edge Functions ativas (não versionadas aqui)
`digisac-webhook`, `admin-digisac-lookup` (integração Digisac/WhatsApp),
`cron-expirar-sessoes`, `cron-expirar-avaliacoes` (crons). Exportar quando for mexer.
