# EXPLAIN — migrations 089/090/091 (split de `external`, cron, reconciliação automática)

> **Status: ✅ MEDIDO em 24/09/2026 antes de aplicar (rollback) — faltam só (4c)
> proacl e (5) cron, que exigem aplicação.**
> Quem escreveu o código (`victor`) **não tem credencial de produção**. As queries
> abaixo foram rodadas pelo coordenador contra `npqyvjhvtfahuxfmuhie` dentro de
> `begin … rollback` (nada persistiu) — ver "Saídas cruas — 24/09/2026" abaixo.
> (4c) e (5) só podem ser medidas **depois** de 089/090/091 aplicadas de verdade
> (proacl da função nova e o job do cron só existem pós-deploy).
>
> Precedente do mesmo sistema: `086-087-explain-pendente.md`.

## ⚠️ Leia antes de rodar

1. **`explain analyze` em `UPDATE`/`DELETE` EXECUTA o comando.** As queries 3 e 4
   abaixo escrevem. Rodar **sempre** dentro de `begin; … rollback;`. Cada bloco já
   vem com o `begin`/`rollback` escrito — não separar.
2. **Conexão:** session pooler `aws-1-us-east-2.pooler.supabase.com:5432` (porta
   5432, não a 6543 — DDL/transação exigem sessão). `db.npqyvjhvtfahuxfmuhie
   .supabase.co` **não resolve** neste projeto, e a região **não** é `sa-east-1`.
   (Anotado em `086-087-explain-pendente.md`.)
3. **Ordem:** aplicar 089 → 090 → 091, depois rodar as 4 queries.
4. Colar a **saída crua**, não parafrasear.

## Checklist

- [x] (1) fila de pendências — comportamento real
- [x] (1b) fila de pendências — com `enable_seqscan=off`
- [x] (2) cursor do reconcile
- [x] (3) os 2 `UPDATE` do passo 3, **2× cada** (a 2ª tem que dar `rows=0`)
- [x] (4) a RPC nova numa demanda de teste (dentro de `rollback`)
- [x] Colar a saída crua de cada uma neste arquivo
- [x] Confirmar `Index Scan using idx_demands_assignee_pending` em (1b)

## Saídas cruas — 24/09/2026, coordenador, ANTES de aplicar

Método: `begin` → `DROP INDEX` + `CREATE INDEX` da 089 (e o `UPDATE` de backfill, na
medição de distribuição) → `explain (analyze, buffers)` → `rollback`. Nada persistiu.
Índice medido com o predicado exato da 089. O backfill NÃO estava aplicado nas medições
(1)/(1b), por isso `rows=1` (só o `none`).

### (1) sem forçar — o planner já escolheu o índice

```
Limit  (cost=7.74..15.32 rows=3 width=250) (actual time=5.472..5.477 rows=1 loops=1)
  ->  Result ... -> Sort (Sort Key: d.created_at DESC, quicksort 26kB)
        ->  Hash Join (Hash Cond: (c.slug = d.client_slug))
              ->  Seq Scan on clients c (rows=32)
              ->  Hash
                    ->  Bitmap Heap Scan on demands d (actual rows=1)
                          Recheck Cond: (clickup_assignee_sync = ANY ('{partial,none,external_loss}'::text[]))
                          ->  Bitmap Index Scan on idx_demands_assignee_pending (actual time=0.025..0.026 rows=1)
        SubPlan 1 -> Aggregate -> Seq Scan on demand_operators dop (Filter: demand_id = d.id)
Buffers: shared hit=7 read=1
Planning Time: 11.257 ms
Execution Time: 5.604 ms
```

### (1b) `set local enable_seqscan = off` — casamento provado

```
Limit  (cost=0.27..18.05 rows=3 width=250) (actual time=0.731..0.733 rows=1 loops=1)
  ->  Nested Loop
        ->  Index Scan using idx_demands_assignee_pending on demands d (actual time=0.649..0.649 rows=1)
        ->  Memoize (Cache Key: d.client_slug) -> Index Scan using clients_pkey on clients c
        SubPlan 1 -> Aggregate -> Bitmap Heap Scan on demand_operators dop
              ->  Bitmap Index Scan on idx_demand_operators_demand (Index Cond: demand_id = d.id)
Buffers: shared hit=6 read=1
Planning Time: 1.200 ms
Execution Time: 0.826 ms
```

Linha de base ANTES da 089 (índice antigo, lista `partial,none,external`): sem forçar
`Seq Scan on demands` (3 buffers, 13 linhas, 8,6 ms); com `enable_seqscan=off`
`Index Scan using idx_demands_assignee_pending` (6,1 ms). Mesma forma, predicado novo.

### Distribuição do backfill (simulado em rollback, versão por NOME)

`external_loss` 3 · `external_added` 4 · `external_reassigned` 5 = 12. Rótulos
corretos, mas `missing_names` inflado em 2 `loss` por casamento de nome ("Luis
Fernando" × "Luis Fernando Pinto Ferreira da Costa"; "Iromar Júnior" × "Iromar
Marques da Silva Junior"). Backfill reescrito para casar `missing` por
`clickup_user_id` via `demand_operators`.

**Re-medido com a versão por ID (rollback):** mesma distribuição 3 · 4 · 5.
`missing_names` corrigido nas 2 linhas: "EDIÇÃO DE CRIATIVOS" → `["Guilherme Silva"]`,
"AJUSTE DO BOTÃO WHATSAPP" → `["Matheus Vasconcellos"]`. As 12 linhas:

| estado | demanda | entrou | saiu |
|---|---|---|---|
| added | Edição Criativos (04/09) | Ramon Waltz | — |
| added | Vídeos de conteúdo para o Instagram (14/09) | Ramon Waltz, Matheus Vieira | — |
| added | Conteúdos para redes sociais (14/09) | Ramon Waltz, Matheus Vieira | — |
| added | Edição Metraladora (21/09) | Ramon Waltz | — |
| loss | EDIÇÃO DE CRIATIVOS (26/08) | — | Guilherme Silva |
| loss | AJUSTE DO BOTÃO WHATSAPP (26/08) | — | Matheus Vasconcellos |
| loss | VSL - Sessão (31/08) | — | Marcos Paulo |
| reassigned | Ajuste da VSL - Guia Fazenda (08/09) | Ramon Waltz | Marcos Paulo |
| reassigned | Criativos campanha (14/09) | Ramon Waltz, Matheus Vieira | Matheus Vasconcellos |
| reassigned | Cortes para conteúdo no Instagram (18/09) | Ramon Waltz | Caio Marcondes, Emmanuel Fernandes, Luis Fernando |
| reassigned | Ajuste Formato VSL (23/09) | Ramon Waltz | Marcos Paulo |
| reassigned | VSL 2 - Sessão de Viabilidade (24/09) | Ramon Waltz | Marcos Paulo |

Leitura operacional: Ramon Waltz entra em 9 das 12; Marcos Paulo sai em 5 (todas VSL).
Não é bug — é a equipe redistribuindo trabalho no ClickUp. Com a 091, os casos
`reassigned` member→member passam a convergir sozinhos.

### (2) cursor do reconcile

```
Limit  (cost=5.52..5.58 rows=25 width=41) (actual time=0.734..0.739 rows=25 loops=1)
  ->  Sort (Sort Key: created_at, quicksort 28kB)
        ->  Seq Scan on demands (actual rows=29)
              Filter: ((clickup_task_id IS NOT NULL) AND (created_at > '2026-01-01 00:00:00+00'))
Buffers: shared hit=7
Planning Time: 0.594 ms
Execution Time: 0.801 ms
```

`Seq Scan` esperado e correto (29 linhas). Sem índice novo.

### (3) `clickup_notifiable` — 1ª e 2ª passagem, os dois sentidos

(3a) guests → false, 1ª passagem:
```
Update on operators (actual rows=0)
  ->  Seq Scan on operators (actual rows=0)
        Filter: ((clickup_notifiable IS DISTINCT FROM false) AND (clickup_user_id = ANY ('{106071075,84118999,84099161}'::text[])))
        Rows Removed by Filter: 11
Buffers: shared hit=1 · Execution Time: 0.122 ms
```
(3a) 2ª passagem: `actual rows=0`, Execution Time 0.038 ms.

(3b) demais → true, 1ª passagem:
```
Update on operators (actual rows=0)
  ->  Seq Scan on operators (actual rows=0)
        Filter: ((clickup_user_id IS NOT NULL) AND (clickup_notifiable IS DISTINCT FROM true) AND (clickup_user_id <> ALL ('{106071075,84118999,84099161}'::text[])))
        Rows Removed by Filter: 11
Buffers: shared hit=1 · Execution Time: 0.121 ms
```
(3b) 2ª passagem: `actual rows=0`, Execution Time 0.032 ms.

`rows=0` já na 1ª passagem: o estado de produção já bate com o `/team` (o 3º id do
cache, 106071075, não é operador — não há drift hoje). Idempotência provada.

### (4) RPC `apply_clickup_assignees` — 3 caminhos, tudo em `begin … rollback`

Método: `CREATE FUNCTION` com o corpo exato da 091 (já com o `FOR UPDATE` do achado
do Kirad) dentro da transação; demanda real "VSL 2 - Sessão de Viabilidade" (24/09,
`external_reassigned`: portal = Marcos Paulo + Matheus V.; ClickUp = Matheus V. +
Ramon); Ramon inserido em `operators` **dentro da mesma transação**. Nada persistiu —
conferido depois: função não existe, Ramon não existe, `audit_log` sem linha, demanda
com 2 operadores e `external`.

(4a) caminho feliz — `array[118029675, 234063256]`:
```
depois: Matheus Vasconcellos:delivered | Ramon Waltz:delivered
clickup_assignee_sync: ok · clickup_assignee_detail: {}
audit_log.metadata: {before:[Marcos Paulo, Matheus Vasconcellos], after:[Matheus Vasconcellos, Ramon Waltz],
                     added:1, removed:1, operators_applied:2, source:clickup_webhook}
```

(4b) regressão do bug destrutivo — `array[118029675, 230453991]` (Gabriel Alves, fantasma):
```
ERROR: P0001: Assignee(s) do ClickUp sem operador ativo cadastrado: {230453991}.
       Cadastre-os (ou corrija o clickup_user_id) antes de aplicar. Nada foi alterado.
CONTEXT: PL/pgSQL function apply_clickup_assignees(uuid,bigint[]) line 15 at RAISE
```
Contagem de `demand_operators` da demanda antes = depois = 2.

(4c) lista vazia — `array[]::bigint[]`:
```
ERROR: 22023: Lista de assignees vazia — recusado. Esvaziar os responsáveis de uma
       demanda não é automatizável (ver bug destrutivo de 03/09/2026); use o painel.
CONTEXT: PL/pgSQL function apply_clickup_assignees(uuid,bigint[]) line 8 at RAISE
```

### (4c) `proacl` pós-aplicação — 24/09/2026 (088–094 aplicadas via MCP `apply_migration`)

```
apply_clickup_assignees            → {postgres=X/postgres,service_role=X/postgres}                 public_residual=false
_cron_reconcile_assignees          → {postgres=X/postgres,service_role=X/postgres}                 public_residual=false
_resync_demand_assignees           → {postgres=X/postgres,service_role=X/postgres}                 public_residual=false
admin_resolve_assignee_divergence  → {postgres=X,service_role=X,authenticated=X}                   public_residual=false
admin_add_demand_operator          → {postgres=X,service_role=X,authenticated=X}                   public_residual=false
admin_remove_demand_operator       → {postgres=X,service_role=X,authenticated=X}                   public_residual=false
get_schema_drift_status            → {=X/postgres,postgres=X,service_role=X,authenticated=X}       public_residual=TRUE (fora do lote; guard is_admin())
has_function_privilege('anon', …, 'EXECUTE') = false nas 3 conferidas · 1 sobrecarga por função
FOR UPDATE presente nas 4 funções · cron.job reconcile-assignees '0 4 * * *' active=true
sync após backfill: ok 12 · external_loss 3 · external_added 4 · external_reassigned 5 · partial_expected 4 · none 1 · external 0
```

### (5) cron — wrapper `portal._cron_reconcile_assignees()` disparado à mão, 2×

```
1ª (01:12 UTC, antes das demandas de teste):
  {"checked":29,"ok":true,"partial":0,"partial_expected":4,"none":1,"skipped_external":12,"errors":[],"next_cursor":null,"batches":2,"stopped_reason":"completed","ok_count":12}
2ª (01:16 UTC, com 2 demandas de teste):
  {"checked":31,"ok":true,"partial":1,"partial_expected":4,"none":1,"skipped_external":13,"errors":[],"next_cursor":null,"batches":2,"stopped_reason":"completed","ok_count":12}
```
`skipped_external > 0` nos dois: o cron não desfaz o split. Não reagendei para +2 min —
o wrapper é exatamente o comando do `cron.job`; a única diferença seria o gatilho do pg_cron.

## E2E em produção — 24/09/2026 (cliente-demo, tudo apagado no fim)

| # | Ação | Resultado | Asserção |
|---|---|---|---|
| 1 | INSERT demanda + 3 members (1 transação) | task `86akpg5jj`, `ok`, 3×`delivered` | `GET /task` → 3 assignees |
| 2 | INSERT + 3 members + Manuela (guest) | task `86akpg5jk`, `partial_expected`, `permanent:true`, 1×`blocked_guest` | `GET /task` → **3** assignees, HTTP 200 (descarte silencioso reproduzido) · e-mail `demanda_atribuida_guest` → manuela · **1** `divergencia_assignee` → joao (não 11) |
| 3c | ClickUp: +Matheus Vieira na task 1 | webhook em 3 s → **auto-reconciliado**: `added 1`, 4×`delivered`, `ok`, `audit demand_assignee_auto_reconciled`, 0 e-mail | — |
| 3b | ClickUp: −Guilherme +Ana Vieira (não cadastrada) na task 2 | webhook em 2 s → `external_reassigned`, `last_synced` carimbado, 0 e-mail, auto barrada | — |
| 3a | ClickUp: −Iromar na task 1 (remoção pura) | **nenhum evento em 2+ min** (repetido com −Guilherme: idem) | — |
| 5 | wrapper do cron | pegou a perda da task 1: `partial`, Iromar+Guilherme `blocked_other/unknown_rejected`, **1** e-mail → joao | — |
| 4 | RAISE em `accept_clickup` com ID não cadastrado | não executado em produção (exige `is_admin()` via sessão); 091 provada em rollback (4b) | — |

🔴 **Achado:** o ClickUp **não emite `taskAssigneeUpdated` para remoção pura** (adição e
troca chegam em 2–3 s). `external_loss` pelo webhook é raro na prática; a perda pura é
detectada pelo cron diário como `partial/unknown_rejected` → card
[86akpg5uz](https://app.clickup.com/t/86akpg5uz) para rotular como perda.

Limpeza: 8 `demand_operators`, 3 `email_log`, 2 `audit_log`, 2 `demands` apagados
**antes** das tasks; os 2 `taskDeleted` caíram em `unknown_task`. Estado final: 29
demandas, distribuição 12/3/4/5/4/1, `email_log` = 191 (igual ao marco).

### Pré-checagens do Kirad (24/09)

- `portal.clickup_config`: RLS **on**, policy `cu_admin_all` ALL/`{public}` com
  `qual = with_check = portal.is_admin()`. GRANTs: `authenticated` e `service_role`.
  Só admin lê/escreve → BAIXO do alerta fica BAIXO.
- Duplicata em `operators.clickup_user_id`: **nenhuma** → 092 aplica limpa.
- Observação fora do lote: `admin_resolve_assignee_divergence` (086) tem
  `proacl = {=X/postgres, …, authenticated=X}` — EXECUTE para PUBLIC, validação por
  `is_admin()` interna.

---

## (1) Fila de pendências do painel — a query que o índice 089 existe para servir

Esta é a query **real** de `listPendingAssigneeDivergences`
(`lib/api/admin-demandas.ts`), com as colunas que o `select` do PostgREST projeta e o
teto de 50. A lista do `in` é `PENDING_ASSIGNEE_STATES` e tem que ser **idêntica** ao
`WHERE` de `idx_demands_assignee_pending` (089).

**O que se espera:** `Index Scan using idx_demands_assignee_pending`.

```sql
explain (analyze, buffers)
select id, client_slug, client_name, title, status, clickup_task_id, created_at,
       operators_total, clickup_assignee_sync, clickup_assignee_detail
  from portal.v_demands
 where clickup_assignee_sync in ('partial','none','external_loss')
 order by created_at desc
 limit 50;
```

> Colunas conferidas contra a definição de `portal.v_demands` na migration 086
> (recriada lá com `DROP VIEW` + `CREATE VIEW`): `id, client_slug, client_name, title,
> description, status, starts_at, ends_at, clickup_task_id, finalized_at, created_at,
> updated_at, service_type, briefing_status, created_by_name, operators_total,
> messages_count, last_message_at, project_id, project_title, last_message_preview,
> last_message_from, clickup_assignee_sync, clickup_assignee_detail`. Todas as 10
> projetadas acima existem. A 089 **não** mexe na view — `clickup_assignee_sync` é
> coluna direta de `portal.demands`, sem cast, sem `CHECK` e sem enum, então os
> valores novos passam sem alteração de DDL na view.

### (1b) Mesma query, forçando o índice

Com ~29 linhas o `Seq Scan` vence por tamanho e **mascara desalinhamento de
predicado**: a query pode estar com um literal diferente do índice e ainda assim ficar
rápida. Esta passagem é a que realmente prova o casamento caractere a caractere.

```sql
begin;
set local enable_seqscan = off;
explain (analyze, buffers)
select id, client_slug, client_name, title, status, clickup_task_id, created_at,
       operators_total, clickup_assignee_sync, clickup_assignee_detail
  from portal.v_demands
 where clickup_assignee_sync in ('partial','none','external_loss')
 order by created_at desc
 limit 50;
rollback;
```

❌ **Se aparecer `Seq Scan` mesmo com `enable_seqscan=off`**, ou um `Index Scan` em
outro índice: o predicado **não** casa com o `WHERE` parcial. Conferir os três lugares
(índice 089, `PENDING_ASSIGNEE_STATES`, tipo `AssigneeSyncState`) antes de seguir.

### Conferência de sanidade do backfill (não é EXPLAIN, mas rode junto)

```sql
select clickup_assignee_sync, count(*)
  from portal.demands
 group by 1
 order by 2 desc;
```

Antes da 089 (medido 24/09): `ok` 12 · `external` 12 · `partial_expected` 4 · `none` 1.
Depois: **nenhuma** linha deve restar em `external`; as 12 têm que estar distribuídas
entre `external_loss`/`external_reassigned`/`external_added`. Para ver como cada uma
foi classificada e auditar o casamento por nome:

```sql
select id, clickup_assignee_sync,
       clickup_assignee_detail -> 'before'        as esperado,
       clickup_assignee_detail -> 'after'         as no_clickup,
       clickup_assignee_detail -> 'missing_names' as saiu,
       clickup_assignee_detail -> 'extra_names'   as entrou
  from portal.demands
 where clickup_assignee_detail ->> 'backfilled_by' = '089_external_split'
 order by clickup_assignee_sync;
```

⚠️ O backfill casa `missing` **por nome** (é só o que o `before` da v4 gravava), com
`lower(btrim(...))` dos dois lados. Nome é chave frágil — acento, apelido ou grafia
divergente entre portal e ClickUp geram falso "missing". Por isso todo caso ambíguo cai
em `external_reassigned` (neutro: não entra na fila, não manda e-mail). **Revisar a
saída desta query** e reclassificar à mão o que estiver errado é esperado, não é falha.

---

## (2) Cursor do reconcile — a query paginada do cron

`reconcileAssigneesBatch` (`clickup-sync` v15). A v15 passou a projetar também
`clickup_assignee_sync`, que é o que permite pular as demandas em `external_*`.

```sql
explain (analyze, buffers)
select id, clickup_task_id, created_at, clickup_assignee_sync
  from portal.demands
 where clickup_task_id is not null
   and created_at > '2026-01-01T00:00:00Z'   -- cursor `after`; sem cursor, remover esta linha
 order by created_at asc
 limit 25;
```

**Expectativa honesta:** com ~29 linhas o planner **vai** escolher `Seq Scan`, e está
**certo** — ler 29 linhas e ordenar custa menos que descer um índice. O que esta
passagem mede não é o plano de hoje, é a **forma** da query: `limit` presente e ordem
por `created_at` (o cursor). Anotar o tempo como linha de base. Se um dia `demands`
passar de alguns milhares de linhas, um índice em `(created_at) where clickup_task_id
is not null` passa a valer — **não criar agora**, seria índice sem uso.

---

## (3) Passo 3 — os 2 `UPDATE` de `clickup_notifiable`, **2× cada**

🔴 **`explain analyze` em `UPDATE` EXECUTA o `UPDATE`.** Todo o bloco abaixo está
dentro de `begin … rollback` de propósito. **Não** rodar as linhas soltas.

O que se quer provar: os `UPDATE` usam `IS DISTINCT FROM`, então a **segunda** execução
seguida tem que afetar **0 linhas**. Um `UPDATE` que reescreve o mesmo valor de hora em
hora gera bloat e dispara trigger à toa.

Os IDs abaixo são os 3 guests do `guest_clickup_ids_cache` em 24/09 (106071075,
84118999 = Caio, 84099161 = Manuela). **Conferir o cache atual antes de rodar:**
`select value from portal.clickup_config where key = 'guest_clickup_ids_cache';`

> `portal.operators.clickup_user_id` é **`text`** (migration 016), não numérico — daí
> os literais entre aspas. Comparar com número dependeria de coerção implícita.

```sql
begin;

-- (3a) guests → false, 1ª passagem
explain (analyze, buffers)
update portal.operators
   set clickup_notifiable = false
 where clickup_user_id = any (array['106071075','84118999','84099161'])
   and clickup_notifiable is distinct from false;

-- (3a) 2ª passagem — TEM QUE DAR rows=0
explain (analyze, buffers)
update portal.operators
   set clickup_notifiable = false
 where clickup_user_id = any (array['106071075','84118999','84099161'])
   and clickup_notifiable is distinct from false;

-- (3b) os demais com clickup_user_id → true, 1ª passagem
explain (analyze, buffers)
update portal.operators
   set clickup_notifiable = true
 where clickup_user_id is not null
   and not (clickup_user_id = any (array['106071075','84118999','84099161']))
   and clickup_notifiable is distinct from true;

-- (3b) 2ª passagem — TEM QUE DAR rows=0
explain (analyze, buffers)
update portal.operators
   set clickup_notifiable = true
 where clickup_user_id is not null
   and not (clickup_user_id = any (array['106071075','84118999','84099161']))
   and clickup_notifiable is distinct from true;

rollback;   -- ⚠️ OBRIGATÓRIO
```

**Nota de fidelidade:** a edge **não** executa exatamente este SQL. `syncNotifiableFromTeam`
(`clickup-sync` v15) lê os 11 operadores e filtra em memória (`o.clickup_notifiable !==
false`), depois dispara os `UPDATE` por `id`. O efeito e a propriedade de
idempotência são os mesmos; o SQL acima é a formulação declarativa equivalente, que é o
que o plano pediu para medir. Com 11 linhas, `Seq Scan` é o plano correto nos dois
casos — `idx_operators_not_notifiable` (087) é parcial em `clickup_notifiable=false` e
não serve para (3b).

---

## (4) A RPC nova — `portal.apply_clickup_assignees`

🔴 **Escreve em `demand_operators`.** É a função que reabre o caminho do bug destrutivo
de 03/09. Rodar **só** dentro de `rollback`, e **só** numa demanda de teste que o
coordenador escolha (sugestão: uma de `cliente-demo`). **Não usar `86ajaan7d`** nem
nenhuma das 29 reais.

```sql
begin;

-- Marco: estado ANTES
select dop.operator_id, o.name, o.clickup_user_id, o.status, dop.clickup_delivery
  from portal.demand_operators dop
  join portal.operators o on o.id = dop.operator_id
 where dop.demand_id = '<DEMAND_ID_DE_TESTE>';

-- A chamada. Os IDs são os assignees REAIS que se quer aplicar — todos precisam ser
-- operador com status='active'. Um só sem cadastro = RAISE e nada é tocado.
explain (analyze, buffers)
select portal.apply_clickup_assignees(
  '<DEMAND_ID_DE_TESTE>'::uuid,
  array[<CLICKUP_USER_ID_1>, <CLICKUP_USER_ID_2>]::bigint[]
);

-- Estado DEPOIS (dentro da mesma transação)
select dop.operator_id, o.name, dop.clickup_delivery
  from portal.demand_operators dop
  join portal.operators o on o.id = dop.operator_id
 where dop.demand_id = '<DEMAND_ID_DE_TESTE>';

select clickup_assignee_sync, clickup_assignee_detail
  from portal.demands where id = '<DEMAND_ID_DE_TESTE>';

select event, identifier, metadata from portal.audit_log
 where event = 'demand_assignee_auto_reconciled'
 order by created_at desc limit 1;

rollback;   -- ⚠️ OBRIGATÓRIO
```

### (4b) Regressão do bug destrutivo — **esta não pode faltar**

O teste que importa não é o caminho feliz, é o de falha: um ID sem operador cadastrado
tem que dar `RAISE` **sem apagar nada**. Use um ID fantasma conhecido (ex.
`230453991`, Gabriel Alves) ou `234063256` (Ramon) **enquanto ele ainda não estiver
cadastrado pelo Juan**.

```sql
begin;

select count(*) as antes from portal.demand_operators
 where demand_id = '<DEMAND_ID_DE_TESTE>';

-- Tem que levantar exceção: "Assignee(s) do ClickUp sem operador ativo cadastrado".
select portal.apply_clickup_assignees(
  '<DEMAND_ID_DE_TESTE>'::uuid,
  array[<CLICKUP_USER_ID_VALIDO>, 230453991]::bigint[]
);

rollback;
```

Depois do `rollback`, **fora** da transação, confirmar que a contagem não mudou:

```sql
select count(*) as depois from portal.demand_operators
 where demand_id = '<DEMAND_ID_DE_TESTE>';
```

`antes` e `depois` **iguais**. Também testar a recusa de lista vazia:

```sql
select portal.apply_clickup_assignees('<DEMAND_ID_DE_TESTE>'::uuid, array[]::bigint[]);
-- esperado: RAISE "Lista de assignees vazia — recusado."
```

### (4c) Permissões da RPC — conferir que não nasceu pública

Função nova em schema exposto nasce executável por `PUBLIC`, e `portal` é exposto via
PostgREST. Sem o `REVOKE`, qualquer `anon` com a anon key reescreveria os responsáveis
de qualquer demanda. **`revoke from anon` sozinho não resolve** — a permissão vem de
`PUBLIC` e continua valendo por herança; é o `REVOKE FROM PUBLIC` que fecha.

```sql
select proacl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'portal' and p.proname = 'apply_clickup_assignees';
```

Esperado: **somente** `service_role=X/...` (mais o owner). Se aparecer `=X/` sem papel
antes do `=` (isso é `PUBLIC`), ou `anon=X/` / `authenticated=X/`, **o `REVOKE` não
pegou** — não deployar o webhook até fechar.

Mesma conferência para o wrapper do cron (090):

```sql
select proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'portal' and p.proname = '_cron_reconcile_assignees';
```

---

## (5) Cron — conferir que agendou (não é EXPLAIN)

```sql
select jobid, jobname, schedule, active, command
  from cron.job where jobname = 'reconcile-assignees';
```

Esperado: `0 4 * * *`, `active = true`, comando
`select portal._cron_reconcile_assignees();`.

Para testar sem esperar até 04:00 UTC, reagendar para +2 min, aguardar e conferir:

```sql
select jobid, status, return_message, start_time, end_time
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'reconcile-assignees')
 order by start_time desc limit 5;
```

Esperado: `succeeded`, duração < 150 s. Depois **reverter o horário para `0 4 * * *`**.
A resposta da edge (nos logs da function) deve trazer `batches`, `stopped_reason` e
`skipped_external` — `skipped_external > 0` é a prova de que o cron **não** está
desfazendo o split da 089.
