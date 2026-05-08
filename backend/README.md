# ClickUp Email Backend

Backend simples para receber `taskCommentPosted` do ClickUp e enviar email para o cliente certo com base no `client_task_id` relacionado na task.

## O que ele faz

- recebe webhook em `/webhooks/clickup`
- valida `X-Signature` quando `CLICKUP_WEBHOOK_SECRET` estiver configurado
- usa o `webhook_id:history_item_id` como chave de idempotencia
- ignora comentarios enviados pelo proprio portal (`CLIENTE - ...`)
- ignora `#visto`
- busca a task no ClickUp para descobrir o cliente relacionado
- envia email para os destinatarios cadastrados em `clients.json`
- persiste fila e status em `backend/runtime/notification_state.sqlite3`

## Arquivos

- `backend/server.py`: servidor HTTP e worker de notificacao
- `backend/clients.json`: cadastro dos clientes e emails de destino
- `backend/register_webhook.py`: helper para registrar o webhook no ClickUp

## Configuracao

Preencha os emails de cada cliente em `backend/clients.json`.

Variaveis obrigatorias:

- `CLICKUP_API_TOKEN`

Variaveis recomendadas:

- `CLICKUP_WEBHOOK_SECRET`

Transporte de email:

- `MAIL_TRANSPORT=log`: nao envia email; apenas loga a mensagem
- `MAIL_TRANSPORT=smtp`: envia de verdade por SMTP

Variaveis de SMTP quando `MAIL_TRANSPORT=smtp`:

- `SMTP_HOST`
- `SMTP_PORT` default `587`
- `SMTP_FROM`
- `SMTP_USER` opcional
- `SMTP_PASSWORD` opcional
- `SMTP_USE_TLS` default `true`

## Rodando

Exemplo local em modo log:

```bash
export CLICKUP_API_TOKEN='SEU_TOKEN'
export MAIL_TRANSPORT='log'
python3 backend/server.py
```

Exemplo com SMTP:

```bash
export CLICKUP_API_TOKEN='SEU_TOKEN'
export CLICKUP_WEBHOOK_SECRET='SEGREDO_DO_WEBHOOK'
export MAIL_TRANSPORT='smtp'
export SMTP_HOST='smtp.seudominio.com'
export SMTP_PORT='587'
export SMTP_FROM='notificacoes@seudominio.com'
export SMTP_USER='notificacoes@seudominio.com'
export SMTP_PASSWORD='SUA_SENHA'
python3 backend/server.py
```

Health check:

```bash
curl http://127.0.0.1:8787/healthz
```

## Registrar webhook no ClickUp

Depois de publicar esse backend em uma URL HTTPS publica, rode:

```bash
export CLICKUP_API_TOKEN='SEU_TOKEN'
python3 backend/register_webhook.py --endpoint 'https://seu-dominio.com/webhooks/clickup'
```

O retorno do ClickUp inclui o `secret` do webhook. Guarde esse valor e configure em `CLICKUP_WEBHOOK_SECRET`.

## Limites atuais

- anexos nao sao enviados por email; o email leva o link da task
- se `clients.json` estiver sem email para um cliente, o evento sera marcado como `ignored`
- esse backend nao altera o front; ele so observa comentarios feitos no ClickUp e dispara notificacao por email
