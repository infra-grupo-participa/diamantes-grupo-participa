# EXPLAIN — migrations 086/087 (sync de responsáveis ClickUp)

> **Status: ✅ EXECUTADO em 03/09/2026, medição (b) REFEITA no mesmo dia.**
> Este documento era uma pendência aberta (as migrations não podiam ser
> aplicadas por falta de credencial). O Marcio forneceu a senha do banco; as
> migrations **086 e 087 foram aplicadas em produção**
> (`npqyvjhvtfahuxfmuhie`) e o `explain (analyze, buffers)` exigido pelo
> `~/.claude/PROTOCOLO-SUSTENTABILIDADE.md` está colado abaixo.
>
> A primeira versão da passagem (b) media uma query simplificada (10 colunas,
> `limit 50`) que **não era** a query real de `listAllDemands` — a função não
> tinha `.limit()` nenhum e projetava 22 colunas com 7 subqueries
> correlacionadas por linha, não 2. O `fable-orchestrator` reprovou em
> otimização por isso. Correção: `listAllDemands` ganhou teto rígido (200,
> mesmo padrão `Math.min` de `listPendingAssigneeDivergences`) e a passagem
> (b) foi refeita com a query EXATA do código, teto incluído.

## Como foi executado

- Conexão direta ao **session pooler**: `aws-1-us-east-2.pooler.supabase.com:5432`
  (porta 5432, não a 6543 de transaction pooling — DDL exige sessão).
  ⚠️ `db.npqyvjhvtfahuxfmuhie.supabase.co` **não resolve** neste projeto, e a
  região **não** é `sa-east-1` como o restante da operação. Anotar: foi preciso
  varrer as regiões do pooler para achar `us-east-2`.
- Cada migration aplicada em **transação única** (`begin` / `commit`), com rollback
  automático em erro. Nenhuma falhou.
- `portal.demands` tinha **16 linhas** no momento da medição.

## Checklist

- [x] Rodar (a) e (b) contra o banco remoto com a migration 086 já aplicada.
- [x] Colar a saída crua (não parafrasear) nesta nota.
- [x] Confirmar que o índice é escolhido em (a) com `enable_seqscan=off`.

## Veredito das 3 passagens

- **(a1) fila de pendências, comportamento real:** `Index Scan using
  idx_demands_assignee_pending`, **0,196 ms**. O planner escolhe o índice **por
  conta própria**, sem forçar — porque a coluna `clickup_assignee_sync` já está
  populada (backfill de 03/09). O bloco cru mostra `rows=0` no Index Scan
  (estimativa do planner: `rows=3`) — hoje **nenhuma** das 16 demandas está em
  `partial`/`none`/`external`. O índice parcial cobre esses 3 estados; as
  demandas em `partial_expected` (fora do índice por decisão de produto — ver
  `PENDING_ASSIGNEE_STATES`) não entram nessa contagem.
- **(a2) mesma query com `enable_seqscan=off`:** `Index Scan using
  idx_demands_assignee_pending`, **0,045 ms**, `Buffers: shared hit=1`.
  ✅ **A expressão do índice parcial CASA com o predicado da query** — o `WHERE`
  do índice bate caractere a caractere com `PENDING_ASSIGNEE_STATES`
  (`lib/api/admin-demandas.ts`). Era o que se queria provar.
- **(b) listagem do painel — query REAL de `listAllDemands` (22 colunas,
  `limit 200`), medida em 03/09/2026 após a correção do teto:** **7,270 ms**,
  16 linhas. `Seq Scan on demands` (correto: a listagem não filtra por estado
  de sync) + `Memoize` na junção com `clients` (`loops=16`) + **7 SubPlans por
  linha** (`created_by_name`, `operators_total`, `messages_count`,
  `last_message_at`, `project_title`, `last_message_preview`,
  `last_message_from`), cada um em `loops=16`. `clickup_assignee_detail` segue
  **fora** da projeção da listagem — o jsonb só é carregado no modal.

## Teto aplicado em `listAllDemands` (correção pós-reprovação de otimização)

`listAllDemands` (`lib/api/admin-demandas.ts`) **não tinha `.limit()` nenhum**
— carregava toda `portal.v_demands` filtrada, sem teto. A view projeta 22
colunas e tem **7 subqueries correlacionadas por linha** (não 2, como a
medição anterior — feita com uma query simplificada de 10 colunas —
sugeria). Cada subquery roda uma vez por linha retornada: sem teto, o custo
cresce linearmente com o volume de demandas e nada segura.

Correção: `listAllDemands` agora aceita `limit` (via `DemandFilter.limit`),
com **teto rígido de 200** (mesmo padrão de `Math.min` já usado em
`listPendingAssigneeDivergences`). Default 200 é generoso para o uso real —
`app/admin/demandas/page.tsx` é Kanban/listagem operacional, não relatório
histórico, e nenhuma tela pagina hoje. Com 16 demandas o teto não muda nada na
prática (a query já retorna todas as 16); ele existe para segurar o
crescimento futuro.

**A condição de reabertura deste ponto já estava satisfeita no dia zero** —
`listAllDemands` nunca teve `limit`. Não é uma regressão a vigiar; era uma
lacuna a fechar, e foi fechada nesta correção. Vigilância daqui para frente:
se `listAllDemands` ou a fila de pendências perderem o `.limit()` (ou o teto
for elevado sem nova medição), este ponto reabre.

## Saída crua — execução única de 03/09/2026

A saída abaixo é de **uma única execução**, incluindo a query exata como foi
rodada (não uma reconstrução). Os números do veredito acima vêm deste bloco.

```
# conectado porta 5432
-- portal.demands linhas: 16

===== (a1) FILA DE PENDENCIAS -- comportamento real =====
-- QUERY EXATA:
select id, client_slug, title, status, clickup_task_id, created_at,
       operators_total, clickup_assignee_sync, clickup_assignee_detail
  from portal.v_demands
 where clickup_assignee_sync in ('partial', 'none', 'external')
 order by created_at desc
 limit 50;
-- PLANO:
Limit  (cost=7.07..10.97 rows=3 width=158) (actual time=0.106..0.108 rows=0 loops=1)
  Buffers: shared hit=6
  ->  Result  (cost=7.07..10.97 rows=3 width=158) (actual time=0.105..0.107 rows=0 loops=1)
        Buffers: shared hit=6
        ->  Sort  (cost=7.07..7.07 rows=3 width=150) (actual time=0.105..0.106 rows=0 loops=1)
              Sort Key: d.created_at DESC
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=6
              ->  Hash Join  (cost=2.67..7.04 rows=3 width=150) (actual time=0.061..0.062 rows=0 loops=1)
                    Hash Cond: (c.slug = d.client_slug)
                    Buffers: shared hit=3
                    ->  Seq Scan on clients c  (cost=0.00..4.21 rows=21 width=13) (actual time=0.044..0.044 rows=1 loops=1)
                          Buffers: shared hit=2
                    ->  Hash  (cost=2.63..2.63 rows=3 width=150) (actual time=0.005..0.006 rows=0 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 8kB
                          Buffers: shared hit=1
                          ->  Index Scan using idx_demands_assignee_pending on demands d  (cost=0.12..2.63 rows=3 width=150) (actual time=0.005..0.005 rows=0 loops=1)
                                Buffers: shared hit=1
        SubPlan 1
          ->  Aggregate  (cost=1.28..1.29 rows=1 width=8) (never executed)
                ->  Index Only Scan using idx_demand_operators_demand on demand_operators dop  (cost=0.14..1.27 rows=2 width=0) (never executed)
                      Index Cond: (demand_id = d.id)
                      Heap Fetches: 0
Planning:
  Buffers: shared hit=241 dirtied=1
Planning Time: 2.458 ms
Execution Time: 0.196 ms

===== (a2) FILA DE PENDENCIAS -- enable_seqscan=off (prova que o indice CASA) =====
-- QUERY EXATA:
select id, client_slug, title, status, clickup_task_id, created_at,
       operators_total, clickup_assignee_sync, clickup_assignee_detail
  from portal.v_demands
 where clickup_assignee_sync in ('partial', 'none', 'external')
 order by created_at desc
 limit 50;
-- PLANO:
Limit  (cost=0.26..12.64 rows=3 width=158) (actual time=0.005..0.006 rows=0 loops=1)
  Buffers: shared hit=1
  ->  Nested Loop  (cost=0.26..12.64 rows=3 width=158) (actual time=0.004..0.004 rows=0 loops=1)
        Buffers: shared hit=1
        ->  Index Scan using idx_demands_assignee_pending on demands d  (cost=0.12..2.63 rows=3 width=150) (actual time=0.003..0.003 rows=0 loops=1)
              Buffers: shared hit=1
        ->  Index Only Scan using clients_pkey on clients c  (cost=0.14..1.99 rows=1 width=13) (never executed)
              Index Cond: (slug = d.client_slug)
              Heap Fetches: 0
        SubPlan 1
          ->  Aggregate  (cost=1.28..1.29 rows=1 width=8) (never executed)
                ->  Index Only Scan using idx_demand_operators_demand on demand_operators dop  (cost=0.14..1.27 rows=2 width=0) (never executed)
                      Index Cond: (demand_id = d.id)
                      Heap Fetches: 0
Planning:
  Buffers: shared hit=1
Planning Time: 0.359 ms
Execution Time: 0.045 ms

===== (b) LISTAGEM DO PAINEL -- query REAL de listAllDemands, 22 colunas, limit 200
     (medido em 03/09/2026 APÓS aplicar o teto — substitui a medição anterior,
     que usava uma query simplificada de 10 colunas e por isso subestimava o custo) =====
-- QUERY EXATA (copiada de lib/api/admin-demandas.ts, sem filtros de status/cliente/busca):
select id, client_slug, client_name, title, description, status, starts_at, ends_at,
       clickup_task_id, finalized_at, created_at, updated_at, service_type, briefing_status,
       created_by_name, operators_total, messages_count, last_message_at, project_id,
       project_title, last_message_preview, last_message_from, clickup_assignee_sync
  from portal.v_demands
 order by created_at desc
 limit 200;
-- PLANO:
Limit  (cost=7.98..203.47 rows=16 width=560) (actual time=1.804..6.943 rows=16 loops=1)
  Buffers: shared hit=185
  ->  Result  (cost=7.98..203.47 rows=16 width=560) (actual time=1.802..6.939 rows=16 loops=1)
        Buffers: shared hit=185
        ->  Sort  (cost=7.98..8.02 rows=16 width=424) (actual time=0.221..0.228 rows=16 loops=1)
              Sort Key: d.created_at DESC
              Sort Method: quicksort  Memory: 32kB
              Buffers: shared hit=16
              ->  Nested Loop  (cost=0.15..7.66 rows=16 width=424) (actual time=0.081..0.174 rows=16 loops=1)
                    Buffers: shared hit=13
                    ->  Seq Scan on demands d  (cost=0.00..3.16 rows=16 width=410) (actual time=0.024..0.065 rows=16 loops=1)
                          Buffers: shared hit=3
                    ->  Memoize  (cost=0.15..0.58 rows=1 width=27) (actual time=0.006..0.006 rows=1 loops=16)
                          Cache Key: d.client_slug
                          Cache Mode: logical
                          Hits: 11  Misses: 5  Evictions: 0  Overflows: 0  Memory Usage: 1kB
                          Buffers: shared hit=10
                          ->  Index Scan using clients_pkey on clients c  (cost=0.14..0.57 rows=1 width=27) (actual time=0.017..0.017 rows=1 loops=5)
                                Index Cond: (slug = d.client_slug)
                                Buffers: shared hit=10
        SubPlan 1
          ->  Index Scan using users_pkey on users u  (cost=0.14..2.36 rows=1 width=20) (actual time=0.086..0.086 rows=1 loops=16)
                Index Cond: (id = d.created_by)
                Buffers: shared hit=32
        SubPlan 2
          ->  Aggregate  (cost=1.28..1.29 rows=1 width=8) (actual time=0.010..0.010 rows=1 loops=16)
                Buffers: shared hit=17
                ->  Index Only Scan using idx_demand_operators_demand on demand_operators dop  (cost=0.14..1.27 rows=2 width=0) (actual time=0.008..0.009 rows=2 loops=16)
                      Index Cond: (demand_id = d.id)
                      Heap Fetches: 0
                      Buffers: shared hit=17
        SubPlan 3
          ->  Aggregate  (cost=2.18..2.19 rows=1 width=8) (actual time=0.009..0.009 rows=1 loops=16)
                Buffers: shared hit=32
                ->  Seq Scan on demand_messages dmsg  (cost=0.00..2.17 rows=4 width=0) (actual time=0.006..0.007 rows=1 loops=16)
                      Filter: (demand_id = d.id)
                      Rows Removed by Filter: 19
                      Buffers: shared hit=32
        SubPlan 5
          ->  Result  (cost=0.97..0.98 rows=1 width=8) (actual time=0.006..0.006 rows=1 loops=16)
                Buffers: shared hit=24
                InitPlan 4
                  ->  Limit  (cost=0.14..0.97 rows=1 width=8) (actual time=0.005..0.005 rows=0 loops=16)
                        Buffers: shared hit=24
                        ->  Index Only Scan Backward using demand_messages_demand_idx on demand_messages dmsg2  (cost=0.14..3.47 rows=4 width=8) (actual time=0.005..0.005 rows=0 loops=16)
                              Index Cond: (demand_id = d.id)
                              Heap Fetches: 8
                              Buffers: shared hit=24
        SubPlan 6
          ->  Bitmap Heap Scan on projects p  (cost=1.24..2.35 rows=1 width=26) (actual time=0.214..0.214 rows=0 loops=16)
                Recheck Cond: (id = d.project_id)
                Heap Blocks: exact=3
                Buffers: shared hit=6
                ->  Bitmap Index Scan on projects_pkey  (cost=0.00..1.24 rows=1 width=0) (actual time=0.078..0.078 rows=0 loops=16)
                      Index Cond: (id = d.project_id)
                      Buffers: shared hit=3
        SubPlan 7
          ->  Limit  (cost=0.14..0.97 rows=1 width=11) (actual time=0.005..0.005 rows=0 loops=16)
                Buffers: shared hit=24
                ->  Index Scan Backward using demand_messages_demand_idx on demand_messages dmsg3  (cost=0.14..3.47 rows=4 width=11) (actual time=0.005..0.005 rows=0 loops=16)
                      Index Cond: (demand_id = d.id)
                      Buffers: shared hit=24
        SubPlan 8
          ->  Limit  (cost=0.29..2.06 rows=1 width=40) (actual time=0.080..0.080 rows=0 loops=16)
                Buffers: shared hit=34
                ->  Nested Loop Left Join  (cost=0.29..7.40 rows=4 width=40) (actual time=0.079..0.080 rows=0 loops=16)
                      Buffers: shared hit=34
                      ->  Index Scan Backward using demand_messages_demand_idx on demand_messages dmsg4  (cost=0.14..3.47 rows=4 width=24) (actual time=0.002..0.002 rows=0 loops=16)
                            Index Cond: (demand_id = d.id)
                            Buffers: shared hit=24
                      ->  Memoize  (cost=0.15..1.54 rows=1 width=22) (actual time=0.153..0.153 rows=1 loops=8)
                            Cache Key: dmsg4.user_id
                            Cache Mode: logical
                            Hits: 2  Misses: 6  Evictions: 0  Overflows: 0  Memory Usage: 1kB
                            Buffers: shared hit=10
                            ->  Index Scan using users_pkey on users u3  (cost=0.14..1.53 rows=1 width=22) (actual time=0.201..0.201 rows=1 loops=6)
                                  Index Cond: (id = dmsg4.user_id)
                                  Buffers: shared hit=10
Planning:
  Buffers: shared hit=637
Planning Time: 10.185 ms
Execution Time: 7.270 ms
```
