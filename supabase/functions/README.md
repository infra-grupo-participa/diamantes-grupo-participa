# Edge Functions (Supabase) — integração ClickUp

A integração com o ClickUp **NÃO** roda nas rotas Next.js do app. Ela é feita por
**Supabase Edge Functions + triggers no banco + segredos no Vault**. Estes arquivos
são a **cópia versionada** das funções que vivem no projeto Supabase
`npqyvjhvtfahuxfmuhie` — a fonte da verdade é o deploy lá (`supabase functions deploy`).
Mantenha este diretório em sincronia ao editar uma função.

## Deploy — GitHub Actions (`.github/workflows/supabase-deploy.yml`)

Desde 2026-09-03, `db/migrations/**` e `supabase/functions/**` têm deploy automatizado:
push na `main` que toque um desses paths dispara `supabase db push` (migrations) +
`supabase functions deploy` (cada função listada no workflow). Antes disso, migration
e edge function eram aplicadas manualmente (MCP `apply_migration` / CLI local) —
continue documentando "aplicar via X" nas migrations novas para quem revisar sem CI.

**Secrets que precisam existir no repo** (Settings → Secrets and variables → Actions),
nenhum commitado:
- `SUPABASE_ACCESS_TOKEN` — token pessoal de acesso (supabase.com/dashboard/account/tokens).
- `SUPABASE_DB_PASSWORD` — senha do Postgres do projeto (Settings → Database no painel).
- `SUPABASE_PROJECT_ID` — `npqyvjhvtfahuxfmuhie`.

### ⚠️ Primeiro deploy — leia antes de rodar o workflow pela primeira vez

As edge functions deste repo têm avisos de que foram **editadas sobre a cópia local**,
sem diff contra o remoto (`clickup-sync` linhas iniciais e `clickup-webhook` idem —
`supabase functions download` exige `SUPABASE_ACCESS_TOKEN`, indisponível no ambiente
onde essas edições foram feitas). Se o painel do Supabase tiver correções feitas
DIRETO lá (fora deste repo) desde a última cópia versionada, **rodar o workflow cego
sobrescreve essas correções sem aviso** — `supabase functions deploy` não faz merge,
substitui o arquivo inteiro.

Antes do primeiro `push`/`workflow_dispatch` que rode este workflow:
1. De uma máquina com `SUPABASE_ACCESS_TOKEN` configurado, rode
   `supabase functions download clickup-sync` e `supabase functions download
   clickup-webhook` (e as demais listadas no workflow).
2. Diffe cada uma contra a cópia deste diretório.
3. Se houver divergência, decida manualmente qual versão é a certa (reaplique no
   repo o que for correção real feita no painel) ANTES de deixar o workflow rodar.

Isto é deliberadamente **manual, não automatizado** — não há como o CI decidir sozinho
qual lado está certo numa divergência.

**Risco conhecido, não confirmado neste ambiente:** a migration 086 usa
`CREATE INDEX CONCURRENTLY`, que não roda dentro de transação. Se o primeiro
`supabase db push` falhar com "CREATE INDEX CONCURRENTLY cannot run inside a
transaction block", mover esse `CREATE INDEX` para um arquivo de migration separado
resolve (ver comentário em `086_demand_assignee_sync_state.sql`, seção A2b).

## Status de drift (repo × banco) — painel admin

RPC `portal.get_schema_drift_status()` (migration 087) compara as colunas que o
código espera contra `information_schema.columns` real do schema `portal` (+ chaves
esperadas em `clickup_config`), cacheada 5 min em `portal.schema_drift_cache`. Consumida
pelo painel admin via `lib/api/admin-demandas.ts#getSchemaDriftStatus`. Útil para
confirmar que uma migration realmente rodou (ex.: logo após o workflow de deploy).

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
  - **Assignees — detecção por comparação (migration 086, revisada 2026-09-01 pós-teste
    real na API):** `multiple_assignees` já está **ligado** no espaço 901313801473 —
    `spaceAllowsMultipleAssignees()` (`GET /space`, campo top-level `multiple_assignees`,
    cache 1h) continua existindo como rede caso seja desligado de novo, mas não é mais a
    causa principal de divergência. A causa real é **GUEST**: 2 operadores (Caio
    Marcondes, Manuela Rios) são guest no ClickUp (decisão do Marcio: manter guest, não
    converter) e guest não pode ser assignee — e quando a lista de assignees mistura
    member+guest, o ClickUp **aceita com HTTP 200 e descarta o guest em silêncio** (sem
    erro nenhum). Por isso o portal sempre manda TODOS os assignees e, depois, **compara**
    quem foi pedido com quem voltou de fato na resposta (`reconcileFromResponse`) —
    não há captura de exceção que pegue esse caso. Ausência classificada via cache de
    papéis do workspace (`GET /team`, `role===4` = guest, cache 1h em
    `clickup_config.guest_clickup_ids_cache`): `guest_cannot_assign` (permanente) vs
    `space_single_assignee`/`unknown_rejected`. Estado grava `'partial_expected'`
    (100% guest, permanente, e-mail só na 1ª detecção) ou `'partial'`/`'none'`
    (acionável). `clickup_config.assignee_strategy='legacy'` pula a reconciliação
    (reversão ao comportamento anterior a este lote).
  - ⚠️ **NÃO existe `POST /task/{id}/watcher` na API v2** (404 — testado real). Watcher
    também não serve de fallback para guest (`PUT` com `watchers.add` para guest dá
    `ITEM_096`). Não há fallback de notificação por API para guest — ver seção abaixo.
  - **Erros ITEM_417 (single-assignee) e ITEM_087 (sem acesso à pasta)** são ramos
    **separados** — causas diferentes, log e reconciliação diferentes. Não cobrem o
    caso guest (que é 200 silencioso, não exceção).
  - **Ação `{action:"reconcile_assignees", limit?, after?}`** (manual, não-cron): varre
    demandas com `clickup_task_id` e popula `clickup_assignee_sync/detail` +
    `demand_operators.clickup_delivery` (mesma classificação por guest) só lendo o
    ClickUp — sem escrever assignees. **Paginado** (default `limit=25`, teto 100): sem
    isso, 1.500 demandas × 350ms de throttle estoura os 150s de timeout da Edge
    Function e, sem cursor, perde todo o progresso do lote no meio do caminho. A
    resposta traz `next_cursor` (ISO timestamp) — repassar como `after` na próxima
    chamada até `next_cursor` vir `null`. Usada para o passivo de divergências
    existentes.
  - **Razões de ausência** (`clickup_assignee_detail.missing[].reason`):
    `guest_cannot_assign` (permanente), `space_single_assignee`, `no_clickup_user`
    (operador nunca teve `clickup_user_id` — nunca foi nem podia ser mandado),
    `stale_clickup_user` (ID cadastrado não existe mais no workspace — fantasma, ex.
    Gabriel Alves `230453991`), `unknown_rejected` (existe no workspace, não é guest,
    e mesmo assim não colou — investigação manual).
  - `demand_operators.clickup_delivery` (migration 086/087): estado GRANULAR por
    operador (`delivered|blocked_guest|blocked_other|no_clickup_user|unknown`) —
    torna consultável "quais demandas a Manuela não recebeu" sem varrer
    `clickup_assignee_detail` (jsonb) linha a linha.
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
  - **`taskAssigneeUpdated` (migration 086):** compara `demand_operators` (esperado)
    com os assignees reais da task. Diverge → `demands.clickup_assignee_sync='external'`
    + detail antes/depois + linha em `audit_log` + e-mail aos admins (só na divergência
    NOVA). Converge → volta para `'ok'`. **NUNCA escreve em `demand_operators`** — o
    webhook só observa/registra; resolução é manual do admin via
    `portal.admin_resolve_assignee_divergence`. Requer o evento registrado no ClickUp
    (não é automático só por existir no código — reconfirmar via API do webhook).
    Respeita `clickup_config.assignee_strategy='legacy'` (v4, 2026-09-03) — antes só o
    `clickup-sync` lia essa chave, e em modo legacy o webhook continuava gravando
    `'external'`/mandando e-mail (reversão incompleta).

## Segredos (Supabase Vault, lidos via `portal.get_internal_secret`)
- `clickup_api_key` — token da API do ClickUp (`pk_…`).
- `clickup_webhook_secret` — segredo HMAC do webhook.
- `clickup_sync_internal_key` — chave interna que as triggers usam para chamar as
  funções de saída (`x-internal-key`).

## Config (tabela `portal.clickup_config`, key/value)
`list_id`, `team_id`, `space_id`, `webhook_id`, os IDs dos custom fields
(`field_cliente_slug`, `field_solicitante`, `field_demand_id`, `field_equipe`) e,
desde a migration 086: `assignee_strategy` (`auto`|`legacy`, default `auto`),
`space_multi_assignee_cache` e `guest_clickup_ids_cache` (ambos cache TTL 1h,
geridos pelo código — não editar à mão fora de teste). Desde a migration 086/087:
`assignee_alert_email` (`on`|`off`, default `on`) — desliga só o e-mail de
divergência, sem desligar a reconciliação em si (granularidade que
`assignee_strategy` não dá). Lida por `clickup-sync` E `clickup-webhook` (via
`_shared/notify-admin-divergence.ts`).

## `_shared/` — código compartilhado entre edge functions

`_shared/notify-admin-divergence.ts` — disparo do alerta de divergência (email_log +
`send-email`), extraído em 2026-09-03 porque estava duplicado literalmente em
`clickup-sync` e `clickup-webhook`. Respeita `assignee_alert_email='off'`.

## Operadores GUEST no ClickUp — `clickup_notifiable` + e-mail (migration 087)
Caio Marcondes e Manuela Rios são **guest** no workspace ClickUp (decisão do Marcio:
manter guest, não converter para member/promover a pasta — promoção exigiria plano
Enterprise, `TEAM_110`). Guest **não pode ser assignee nem watcher** de task — é
restrição de papel, sem contorno por API (comentário atribuído a guest também é
ignorado em silêncio pelo campo assignee).

Até 2026-09-01, isso era descoberto POR DEMANDA (`clickup_assignee_sync=
'partial_expected'`) a cada comparação. Desde a migration 087,
`portal.operators.clickup_notifiable` (boolean, default `true`) é um **atributo da
pessoa**, mantido pela reconciliação a partir do cache de guests
(`guest_clickup_ids_cache`). Quando `false`: uma trigger (`AFTER INSERT` em
`demand_operators`) dispara `send-email` (`type:'demanda_atribuida_guest'`) assim que
o operador é atribuído a uma demanda — ele recebe o link da task por e-mail, já que
não vai saber pelo ClickUp. Continua existindo o alerta ao admin por
`clickup_assignee_sync='partial_expected'` (agregado, na comparação pós-resposta) —
os dois canais coexistem: um avisa a PESSOA, o outro avisa o ADMIN.

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
  - `type:'custom'` (`to,subject,html`) → envio manual/teste. Usado também pelos e-mails de
    **reset de senha** e **primeiro acesso**, disparados pelo app (ver abaixo).
  - `type:'divergencia_assignee'` (`demand_id, before, after, context`) → alerta a
    **todos os admins aprovados** (exceto contas `@*.test`). Dois emissores:
    `clickup-webhook` (`context:'webhook'`, estado `'external'` — mudança feita direto
    no ClickUp) e `clickup-sync` (`context:'sync'`, estados `'partial'`/
    `'partial_expected'`/`'none'` — sobretudo guest, ver seção acima). Disparado só na
    1ª detecção de cada divergência (não repete a cada evento/sync enquanto o estado
    continuar divergente). Dedup por admin/dia: `divergencia_assignee:<demand_id>:<dia
    ou stamp>:<email>`.
  - `type:'demanda_atribuida_guest'` (`demand_id, operator_id`, migration 087) → avisa
    o OPERADOR (não o admin) quando ele é `clickup_notifiable=false` (guest) e acabou
    de ser atribuído a uma demanda — link direto pra task no ClickUp, já que ele não
    vai aparecer como assignee/watcher por lá. Disparado por trigger `AFTER INSERT` em
    `demand_operators` (`portal._notify_demanda_atribuida_guest`). Dedup por
    `demanda_atribuida_guest:<demand_id>:<operator_id>` (uma vez por atribuição).
  - **Nova mensagem NÃO dispara e-mail** (o ClickUp já notifica).
- **Triggers:** `demands_email_notify` em `portal.demands` (`_notify_demanda_criada`) e
  `projects_email_notify` em `portal.projects` (`_notify_projeto_criado`).
- **Auditoria/dedup:** tabela `portal.email_log` (status `sent|failed|skipped`, `resend_id`,
  `dedup_key`, `ref_type/ref_id`). RLS: SELECT só admin.
- **Secret:** `resend_api_key` no Vault (whitelist em `portal.get_internal_secret`).
- **Remetente:** `nao-responder@diamantes.grupoparticipa.app.br` (domínio verificado no Resend).

### Reset de senha e primeiro acesso (Resend, sem SMTP do Auth)
O link **não** sai mais pelo SMTP/template do Supabase Auth — o app gera e envia:

1. `POST /api/auth/reset-password` (público) ou `POST /api/admin/criar-acesso` (admin);
2. `admin.generateLink({type:'recovery'})` devolve o `hashed_token` **sem disparar e-mail**;
3. o HTML sai de `lib/email/templates.ts` e vai pela EF `send-email` (`type:'custom'`);
4. o link aponta para **`/auth/confirm`**, que faz `verifyOtp` e abre a sessão de recuperação,
   redirecionando para `/reset-password/update`.

`/auth/callback` (troca `code` do PKCE por sessão) continua no lugar para links antigos.
Como o Next chama a EF, e ela só aceita `x-internal-key` (a service-role JWT **não** casa com
o `SUPABASE_SERVICE_ROLE_KEY` que a EF lê), a chave é buscada no Vault via
`portal.get_internal_secret` — sem env var nova. Não é preciso configurar SMTP no Auth;
`supabase/auth-email-templates/` só serve se um dia o envio voltar para lá.

## Outras Edge Functions ativas (não versionadas aqui)
`digisac-webhook`, `admin-digisac-lookup` (integração Digisac/WhatsApp),
`cron-expirar-sessoes`, `cron-expirar-avaliacoes` (crons). Exportar quando for mexer.

## Passivo de divergências existentes (pós-deploy 086/087) — checklist manual

Depois que a migration 086/087 estiver aplicada E as edge functions deployadas,
rode `{action:"reconcile_assignees"}` (paginado, ver acima) para popular
`clickup_assignee_sync`/`clickup_delivery` das demandas já existentes. Isso só LÊ o
ClickUp — não escreve nada lá nem no `demand_operators`. A partir daí, o painel mostra
a fila de pendências e o admin resolve caso a caso via
`admin_resolve_assignee_divergence` (RPC, `lib/api/admin-demandas.ts#
resolveAssigneeDivergence`). Casos já identificados (2026-09-03, confirmar de novo
pós-reconciliação — o estado pode ter mudado):

- **Classe A (`reapply` — portal está certo):** `86ajz4ymc`, `86ajz4z20`, `86ajz4zr1`
  (vitor-negrao, 11/08 — passivo de quando o multi-assignee estava desligado).
  Esperado após `reapply`: entram Matheus Vasconcellos, Iromar Júnior, Guilherme Silva;
  Caio e Manuela ficam de fora → estado final `partial_expected`, que é CORRETO
  (guest), não pendência. ⚠️ `demand_operators` congela a equipe da ÉPOCA — Caio
  Marcondes está gravado nessas 3 demandas mas SAIU da equipe do Vitor em 01/09
  (Automação virou Marcos Paulo). **Conferir `team_assignments` atual antes de
  reaplicar** — não reatribuir pelo que está congelado em `demand_operators` sem
  checar quem está na equipe HOJE.
- **Classe B (`accept_clickup` — decisão do Marcio, ClickUp manda):** `86ak6832j`,
  `86ak4kgv5` → Luis Fernando (`bae5ed82-15a8-4044-905c-37c5413623da`,
  clickup_user_id `81934454`, já cadastrado e `active` em `portal.operators`) entra no
  banco.
- `86ajaan7d` (cliente-demo): **fixture — fica fora da reconciliação.**

Nenhuma dessas ações foi executada por este lote — é decisão + clique manual do admin
no painel, depois que a fila de pendências estiver visível com dados reais.
