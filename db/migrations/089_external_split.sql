-- 089_external_split
-- Passo 2 do plano definitivo de atribuição de responsáveis (24/09/2026).
--
-- PROBLEMA: o estado 'external' (migration 086) colapsa três situações muito
-- diferentes num rótulo só. Medição de 24/09 em produção: 12 demandas 'external' —
-- só 4 eram PERDA de responsável (alguém removido no ClickUp, trabalho sem dono).
-- As outras 8 eram troca deliberada ou reforço feito pela equipe no ClickUp, ou
-- seja, operação normal. O webhook (handleAssigneeUpdated) JÁ calculava `missing` e
-- `extra` separadamente e jogava os dois fora ao gravar um único 'external'. O custo
-- disso: e-mail de alerta em todos os 12 casos, dos quais 8 eram ruído — parte dos
-- 165 e-mails/30 dias com ZERO divergências resolvidas.
--
-- SOLUÇÃO: três estados derivados das contagens que já existiam.
--   external_loss        missing>0 e extra==0  → perda. Fila do painel + e-mail.
--   external_reassigned  missing>0 e extra>0   → troca. Registra, não alerta.
--   external_added       missing==0 e extra>0  → reforço. Registra, não alerta.
--
-- ⚠️ TRÊS PONTAS QUE TÊM QUE CASAR CARACTERE A CARACTERE (conflito 1 do plano):
--   1. o WHERE do índice parcial idx_demands_assignee_pending (aqui embaixo)
--   2. PENDING_ASSIGNEE_STATES em lib/api/admin-demandas.ts
--   3. o tipo AssigneeSyncState em lib/api/admin-demandas.ts
-- Mudar uma só faz o planner trocar Index Scan por Seq Scan SEM ERRO NENHUM — só
-- fica lento, e ninguém percebe. É o mesmo mecanismo do btrim(lower()) x
-- lower(btrim()) que custou 71.728 linhas varridas por e-mail no outro sistema.
-- Depois de aplicar esta migration, RODAR o EXPLAIN de
-- docs/specs/pendencias/089-091-explain-pendente.md (query 1, inclusive a variante
-- com enable_seqscan=off — com 29 linhas o Seq Scan ganha por tamanho e mascara
-- desalinhamento de predicado).
--
-- Aplicar via `supabase db push` (.github/workflows/supabase-deploy.yml) ou MCP
-- apply_migration name=089_external_split. Esta cópia em arquivo é a fonte da
-- verdade versionada.
--
-- Não há CHECK constraint nem enum em portal.demands.clickup_assignee_sync — foi
-- decisão deliberada da 086 ("um valor inesperado tem que GRAVAR, nunca derrubar a
-- sync"). Confirmado relendo a 086: a coluna é `text` puro. Por isso os valores
-- novos NÃO exigem alteração de constraint, e a view v_demands (recriada na 086)
-- expõe `d.clickup_assignee_sync` como coluna direta, sem cast nem filtro — também
-- não precisa mudar. Verificação para o revisor:
--   select pg_get_constraintdef(oid), conname from pg_constraint
--    where conrelid = 'portal.demands'::regclass and contype = 'c';
--   → nenhum check deve mencionar clickup_assignee_sync.

-- ── 1. Backfill das 12 linhas 'external' ───────────────────────────────────
-- Reclassifica a partir do snapshot já gravado em clickup_assignee_detail:
--   detail->'before' = array de NOMES que o portal esperava (texto)
--   detail->'after'  = array de {id, name} realmente assignees no ClickUp
-- Quem é EXTRA: um id em `after` que NÃO pertence a operador vinculado a ESTA demanda.
-- Quem é MISSING: operador vinculado a ESTA demanda cujo clickup_user_id NÃO está em
-- `after[].id`.
--
-- ✅ OS DOIS LADOS CASAM POR ID, não por nome. A fonte do lado esperado é
-- portal.demand_operators, que AINDA está intacto: o webhook nunca escreveu nessa
-- tabela (ele só observa e registra), então os operadores esperados continuam lá com
-- seu operators.clickup_user_id. O `detail->'before'` é apenas um array de nomes e não
-- serve para casar.
--
-- ⚠️ A primeira versão desta migration casava `missing` por NOME e ERRAVA. Medido em
-- produção pelo coordenador (24/09, dentro de begin/rollback): os rótulos saíam
-- certos (3 loss · 4 added · 5 reassigned) mas `missing_names` vinha com falso
-- positivo em 2 das 12 linhas, porque o portal guarda o nome curto e o ClickUp devolve
-- o nome completo:
--   "AJUSTE DO BOTÃO WHATSAPP": "Luis Fernando" × "Luis Fernando Pinto Ferreira da
--        Costa" → falso missing. Missing real = só Matheus Vasconcellos.
--   "EDIÇÃO DE CRIATIVOS":      "Iromar Júnior" × "Iromar Marques da Silva Junior"
--        → falso missing. Missing real = só Guilherme Silva.
-- É a mesma classe de erro do btrim(lower()) × lower(btrim()): a comparação "quase"
-- casa, não dá erro nenhum, e o resultado sai errado em silêncio. Casar por ID elimina
-- a classe inteira — apelido, acento e grafia deixam de importar.
--
-- Não sobrou casamento por nome em lugar nenhum. Uma demanda sem NENHUM
-- demand_operators (não deve ocorrer em nenhuma das 12) não tem lado esperado para
-- casar: `missing` fica indeterminado, e o CASE manda para 'external_reassigned', o
-- estado NEUTRO — via a guarda `has_ops`. Regra geral de segurança mantida: qualquer
-- caso que não dê para classificar com confiança vai para o neutro — errar para o lado
-- neutro só adia a decisão do admin; errar para 'external_loss' criaria alerta falso,
-- que é exatamente o problema que esta migration existe para acabar.
--
-- ⚠️ RAMON WALTZ (234063256) — o Juan cadastra em portal.operators ANTES desta
-- migration ser aplicada, e o resultado do backfill NÃO muda por causa disso.
-- Confirmado relendo as duas subqueries: `extra` testa "não pertence a operador
-- VINCULADO A ESTA DEMANDA" (NOT EXISTS com `dop.demand_id = dd.id`), não "não existe
-- em operators". Ramon aparece em `after[].id` de 9 linhas e não está em
-- demand_operators de nenhuma delas, então continua contando como extra com ou sem
-- cadastro. O cadastro dele muda o comportamento FUTURO (passa a ser elegível para a
-- reconciliação automática da 091), não a classificação histórica daqui.
--
-- O UPDATE roda antes do índice novo de propósito: reescrever 12 linhas com o índice
-- parcial já criado faria manutenção de índice à toa (irrelevante em 12 linhas, mas
-- a ordem certa é grátis).
UPDATE portal.demands d
   SET clickup_assignee_sync = sub.new_state,
       clickup_assignee_detail = d.clickup_assignee_detail
         || jsonb_build_object(
              'missing_names', sub.missing_names,
              'extra_names',   sub.extra_names,
              'backfilled_by', '089_external_split'
            )
  FROM (
    SELECT
      dd.id,
      mn.missing_names,
      xn.extra_names,
      CASE
        -- Sem snapshot do ClickUp (`after` ausente ou não-array): não há com o que
        -- comparar. Neutro.
        WHEN jsonb_typeof(dd.clickup_assignee_detail -> 'after') IS DISTINCT FROM 'array'
          THEN 'external_reassigned'
        -- Demanda sem nenhum demand_operators: o lado esperado não existe para casar
        -- por ID, então "missing" é indeterminado (não é zero). Neutro, não added.
        WHEN NOT ho.has_ops
          THEN 'external_reassigned'
        WHEN coalesce(jsonb_array_length(mn.missing_names), 0) > 0
         AND coalesce(jsonb_array_length(xn.extra_names), 0) = 0
          THEN 'external_loss'
        WHEN coalesce(jsonb_array_length(mn.missing_names), 0) = 0
         AND coalesce(jsonb_array_length(xn.extra_names), 0) > 0
          THEN 'external_added'
        WHEN coalesce(jsonb_array_length(mn.missing_names), 0) > 0
         AND coalesce(jsonb_array_length(xn.extra_names), 0) > 0
          THEN 'external_reassigned'
        -- missing==0 E extra==0: portal e ClickUp batem hoje, mas o estado gravado é
        -- 'external' (snapshot de uma divergência já resolvida à mão). Não é perda —
        -- neutro. Um reconcile ou o próximo evento do webhook levam para 'ok'.
        ELSE 'external_reassigned'
      END AS new_state
    FROM portal.demands dd
    -- EXTRA: assignee do ClickUp cujo clickup_user_id NÃO pertence a nenhum operador
    -- vinculado a ESTA demanda. (operators.clickup_user_id é TEXT — migration 016 —
    -- daí o ->> 'id' comparar com text direto, sem cast numérico.)
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(a.elem ->> 'name') AS extra_names
        FROM jsonb_array_elements(dd.clickup_assignee_detail -> 'after') AS a(elem)
       WHERE jsonb_typeof(dd.clickup_assignee_detail -> 'after') = 'array'
         AND NOT EXISTS (
           SELECT 1
             FROM portal.demand_operators dop
             JOIN portal.operators o ON o.id = dop.operator_id
            WHERE dop.demand_id = dd.id
              AND o.clickup_user_id = (a.elem ->> 'id')
         )
    ) xn ON true
    -- MISSING (por ID): operador vinculado a ESTA demanda cujo clickup_user_id não
    -- está entre os after[].id do ClickUp. O nome sai de operators.name — o nome que o
    -- portal conhece, que é o que o admin vai ler no painel.
    -- Operador SEM clickup_user_id conta como missing: ele nunca pôde ser assignee, e
    -- do ponto de vista "o ClickUp tem quem o portal espera?" a resposta é não.
    -- `ORDER BY o.name` só para a saída ser estável entre execuções.
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(o.name ORDER BY o.name) AS missing_names
        FROM portal.demand_operators dop
        JOIN portal.operators o ON o.id = dop.operator_id
       WHERE dop.demand_id = dd.id
         AND (
           o.clickup_user_id IS NULL
           OR NOT EXISTS (
             SELECT 1
               FROM jsonb_array_elements(dd.clickup_assignee_detail -> 'after') AS a2(elem)
              WHERE jsonb_typeof(dd.clickup_assignee_detail -> 'after') = 'array'
                AND a2.elem ->> 'id' = o.clickup_user_id
           )
         )
    ) mn ON true
    -- Fallback: a demanda tem algum operador vinculado? Se NÃO tiver, o casamento por
    -- ID acima não pode afirmar nada (missing_names viria NULL, indistinguível de
    -- "ninguém sumiu") e o CASE manda para o neutro em vez de para external_added.
    LEFT JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1 FROM portal.demand_operators dop2 WHERE dop2.demand_id = dd.id
      ) AS has_ops
    ) ho ON true
    WHERE dd.clickup_assignee_sync = 'external'
  ) AS sub
 WHERE d.id = sub.id;

-- ── 2. Índice parcial — a fila de pendências do painel ─────────────────────
-- DROP + CREATE (não é possível alterar o WHERE de um índice parcial no lugar).
-- 'external_reassigned' e 'external_added' ficam FORA: não são pendência, são
-- registro. Mesmo critério que já mantinha 'partial_expected' fora desde a 086.
-- Sem CONCURRENTLY, mesmo motivo documentado na 086: a tabela tem ~29 linhas, não há
-- sessão concorrente a proteger, e CONCURRENTLY não roda dentro de transação — o que
-- quebraria o `supabase db push` e deixaria um índice INVALID que o IF NOT EXISTS de
-- uma re-execução consideraria existente sem nunca reparar.
DROP INDEX IF EXISTS portal.idx_demands_assignee_pending;

CREATE INDEX idx_demands_assignee_pending
  ON portal.demands (created_at DESC)
  WHERE clickup_assignee_sync IN ('partial', 'none', 'external_loss');

-- ── 3. COMMENTs ────────────────────────────────────────────────────────────
COMMENT ON COLUMN portal.demands.clickup_assignee_sync IS
  'Estado da última comparação portal vs ClickUp para os assignees da task (RESUMO
   derivado, para badge do painel — o detalhe por operador vive em
   demand_operators.clickup_delivery). Valores esperados (sem enforcement — divergência
   inesperada deve gravar, não falhar):
   ok                  = todos os operadores da demanda estão como assignee no ClickUp
                          (ou task sem clickup_task_id ainda);
   partial             = 1+ operador esperado ficou de fora por causa NÃO-permanente
                          (ex.: espaço temporariamente single-assignee) — acionável;
   partial_expected    = 1+ operador ficou de fora e a causa é 100% GUEST
                          (clickup_assignee_detail.permanent=true) — ESTADO ESPERADO,
                          não é falha a corrigir. Alerta só na 1ª detecção.
   none                = nenhum operador esperado da demanda está como assignee lá;
   external_loss       = (089) o ClickUp PERDEU responsável(is) que o portal esperava e
                          não ganhou nenhum novo — mudança feita direto no ClickUp.
                          ÚNICO estado external acionável: entra na fila e dispara
                          e-mail. Populado só pelo webhook (taskAssigneeUpdated).
   external_reassigned = (089) TROCA feita direto no ClickUp (saiu gente E entrou
                          gente). Registro, não pendência — não alerta.
   external_added      = (089) REFORÇO feito direto no ClickUp (só entrou gente).
                          Registro, não pendência — não alerta.
   ⚠️ external_loss aparece em TRÊS lugares que têm que casar caractere a caractere:
   o WHERE de idx_demands_assignee_pending, PENDING_ASSIGNEE_STATES e o tipo
   AssigneeSyncState (lib/api/admin-demandas.ts). Ver migration 089.
   O valor legado "external" (086) não é mais gravado por nenhum código — o backfill
   da 089 reclassificou as 12 linhas existentes.
   Não existe watcher como fallback: POST /task/{id}/watcher não existe na API v2 do
   ClickUp, e guest não pode ser watcher (ITEM_096) nem assignee (ITEM_087).';

COMMENT ON COLUMN portal.demands.clickup_assignee_detail IS
  'Detalhe da última comparação de assignees (jsonb, default {}). Formato livre por estado — '
  'tipicamente { sent: [nomes], missing: [{name, clickup_user_id, reason}], permanent: bool } '
  'para "partial"/"partial_expected"/"none" (reason ∈ guest_cannot_assign | space_single_assignee '
  '| no_clickup_user | stale_clickup_user | unknown_rejected), ou { before: [nomes], after: '
  '[{id,name}], missing_names: [nomes], extra_names: [nomes] } para os estados "external_*" '
  '(só webhook). missing_names/extra_names entraram na 089: com before/after apenas, o painel '
  'sabia que divergiu mas não QUEM saiu e QUEM entrou. Consumido só pelo painel admin.';

-- Correção do COMMENT da 087 (conflito 2 do plano: "o COMMENT da 087 é mentira até o
-- passo 3"). A 087 afirmava que clickup_notifiable era "mantida pela reconciliação" —
-- não era: nenhum código escrevia na coluna (grep update|upsert|insert nas edges =
-- vazio), os dois `false` de produção eram edição manual de 03/09, e guest NOVO nunca
-- era marcado. A partir da v15 do clickup-sync a afirmação passa a ser verdadeira, e
-- este COMMENT descreve o mecanismo exato para quem for depurar.
COMMENT ON COLUMN portal.operators.clickup_notifiable IS
  'false = operador é GUEST no ClickUp (não pode ser assignee nem watcher — ITEM_087/
   ITEM_096, descartado em silêncio pelo ClickUp quando misturado com member). Quando
   false, send-email notifica o operador por e-mail com o link da task (ele não vai
   saber pelo ClickUp), via trigger demand_operators_notify_guest.
   PROJEÇÃO PARCIAL do GET /team, mantida por clickup-sync v15 (função
   syncNotifiableFromTeam, passo 3 do plano de 24/09/2026): a cada REVALIDAÇÃO do cache
   guest_clickup_ids_cache (TTL 1h), para os operadores QUE APARECEM naquela resposta do
   /team — false para quem tem role=4 (guest), true para os demais. Só isso.
   NÃO são tocados, e podem portanto estar desatualizados:
     - operador sem clickup_user_id cadastrado (a coluna não afirma nada sobre ele);
     - operador que NÃO apareceu na resposta do /team. O valor true só é gravado por
       AFIRMAÇÃO POSITIVA (ID presente na lista de members), nunca por exclusão de
       "não é guest" — uma resposta 200 parcial (paginação/degradação) omitiria um
       guest, que por exclusão viraria notifiable=true e perderia o e-mail de
       substituição, além de deixar de barrar a reconciliação automática da 091.
   ⚠️ A escrita NÃO acontece se o GET /team falhar ou vier sem members: lista vazia é
   indistinguível de "workspace sem guests".
   ⚠️ NÃO EDITAR À MÃO fora de teste: a próxima revalidação que enxergar o operador
   sobrescreve.
   Entre 087 (03/09) e 089 (24/09) o COMMENT anterior prometia manutenção automática
   que NÃO existia — os 2 valores false eram manuais. Corrigido aqui.';
