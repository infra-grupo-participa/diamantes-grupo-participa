-- 091_apply_clickup_assignees
-- Decisão 4 do Marcio (24/09/2026): troca member→member feita no ClickUp reconcilia
-- sozinha para o banco. "O ClickUp manda" — é o que já se fazia à mão (03/09, caso
-- Luis Fernando). Escopo ESTRITO: só quando os dois lados têm cadastro em
-- portal.operators e nenhum é guest. Qualquer outro caso continua external_* para o
-- admin decidir pelo painel.
--
-- 🔴 ESTA FUNÇÃO REABRE O CAMINHO DO BUG DESTRUTIVO DE 03/09.
-- O bug original vivia em admin_resolve_assignee_divergence (accept_clickup): ela
-- casava os IDs do ClickUp com operators e SÓ ENTÃO os validava. Se o casamento viesse
-- vazio ou parcial, o DELETE FROM demand_operators já tinha rodado — a demanda ficava
-- sem responsável nenhum, sem chance de voltar atrás, e o _resync_demand_assignees
-- seguinte propagava o apagão para o ClickUp também (removia os assignees da task).
-- Foi corrigido na 086 invertendo a ordem. Aqui a MESMA ordem é obrigatória, e com
-- agravante: lá era ação manual de um admin olhando a tela; aqui é AUTOMÁTICA, disparada
-- por um webhook externo. A ordem é, sem exceção:
--     1) resolver os IDs          2) VALIDAR (RAISE se sobrar qualquer um)
--     3) só então DELETE/INSERT
-- Nunca mover o DELETE para antes do passo 2. A função inteira roda em UMA transação
-- (é plpgsql chamado via RPC): o RAISE desfaz tudo, inclusive um INSERT já executado.
--
-- 🔒 SERIALIZADA POR DEMANDA (`SELECT ... FOR UPDATE` em portal.demands, logo após a
-- checagem de existência e ANTES de resolver/validar). Dois eventos concorrentes do
-- webhook para a mesma task, em READ COMMITTED, conseguiam zerar demand_operators sem
-- levantar exceção: o INSERT de T2 avalia o NOT EXISTS contra o snapshot antigo e o
-- DELETE de T2 é reavaliado sob a linha já commitada por T1, removendo o que T1 tinha
-- acabado de inserir — demanda com ZERO responsáveis e clickup_assignee_sync='ok'.
-- Achado do kirad na revisão de 24/09/2026. O lock é por DEMANDA, não global: eventos
-- de tasks diferentes seguem em paralelo. Não remover, e não mover para depois da
-- validação (travar depois de ler é não travar).
--
-- ⚠️ LIMITAÇÃO CONHECIDA — `demand_operators.role`: o INSERT grava o literal
-- 'operator'. Se um dia existir vínculo com role diferente, um operador que saia e
-- volte por esta função perde o role original. Hoje é inócuo: TODO INSERT em
-- demand_operators no repo grava 'operator' (016, 059, 086/accept_clickup e esta) —
-- a coluna não tem outro valor vivo. Enquanto esta função existir, introduzir um role
-- distinto exige mudar o INSERT aqui junto, senão a perda é silenciosa.
--
-- CHAMADOR: só o clickup-webhook v5 (handleAssigneeUpdated → tryAutoReconcile), que
-- aplica uma barreira de elegibilidade ANTES (todos os extras casam com operador ativo;
-- nenhum lado é guest; cache de guests confiável). Essa barreira é conveniência, não
-- segurança — a barreira que vale é a daqui, porque roda em transação e o webhook não
-- é fonte de confiança.
--
-- NÃO GERA LOOP de volta para o ClickUp. Conferido no repo antes de escrever:
--   - portal.demand_operators tem UMA trigger: demand_operators_notify_guest
--     (AFTER INSERT, migration 087) → só manda e-mail, e só quando o operador tem
--     clickup_notifiable=false. Não escreve no ClickUp.
--   - portal._resync_demand_assignees (migration 059, este sim faz net.http_post para
--     a edge clickup-sync) NÃO é trigger de demand_operators: é chamada EXPLÍCITA por
--     admin_add_demand_operator / admin_remove_demand_operator / accept_clickup.
--     Por isso esta função faz INSERT/DELETE DIRETO na tabela e **não reusa**
--     admin_add_demand_operator — reusar dispararia o resync e mandaria de volta ao
--     ClickUp o estado que veio do ClickUp.
--   - o UPDATE em portal.demands toca só clickup_assignee_sync/clickup_assignee_detail;
--     é exatamente o mesmo UPDATE que persistAssigneeSync (clickup-sync) e
--     handleAssigneeUpdated (webhook) já fazem hoje em produção sem loop.
-- ⚠️ O INSERT de um member DISPARA demand_operators_notify_guest. Para member a trigger
-- sai no primeiro IF (clickup_notifiable IS DISTINCT FROM false → RETURN NEW), sem
-- e-mail. Como esta função só é chamada quando nenhum lado é guest, o e-mail não sai —
-- mas a trigger roda, e isso é aceitável e documentado.
--
-- Aplicar via `supabase db push` ou MCP apply_migration name=091_apply_clickup_assignees.

CREATE OR REPLACE FUNCTION portal.apply_clickup_assignees(
  p_demand_id uuid,
  p_clickup_user_ids bigint[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'portal', 'public'
AS $function$
DECLARE
  v_ids_text     text[];
  v_matched_ops  uuid[];
  v_matched_cids text[];
  v_unmatched    text[];
  v_before       text[];
  v_after        text[];
  v_removed      int := 0;
  v_added        int := 0;
BEGIN
  IF p_demand_id IS NULL THEN
    RAISE EXCEPTION 'p_demand_id obrigatório.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM portal.demands WHERE id = p_demand_id) THEN
    RAISE EXCEPTION 'Demanda % não encontrada.', p_demand_id USING ERRCODE = 'P0002';
  END IF;

  -- 🔒 SERIALIZA POR DEMANDA. Sem este lock a função tem uma corrida que ZERA
  -- demand_operators, e sem RAISE nenhum — achado do kirad, 24/09/2026.
  -- O cenário, em READ COMMITTED (default do Postgres), com dois eventos concorrentes
  -- do webhook para a MESMA task:
  --   T1 aplica {A}; T2 aplica {B}. Os dois leem o estado antigo no mesmo snapshot.
  --   O INSERT de T2 passa pelo NOT EXISTS contra o snapshot ANTIGO (não vê o A de T1).
  --   O DELETE de T2 é reavaliado sob a linha JÁ COMMITADA por T1 (READ COMMITTED
  --   re-testa o predicado na versão nova da linha) e remove o A.
  --   Resultado: a demanda pode terminar com ZERO responsáveis, com
  --   clickup_assignee_sync='ok' e sem exceção — o pior modo de falha possível, porque
  --   é silencioso e o estado 'ok' tira a demanda da fila de pendências.
  -- O FOR UPDATE faz a segunda transação ESPERAR a primeira terminar e só então
  -- resolver/validar/aplicar sobre o estado já atualizado. Tem que vir ANTES de
  -- resolver e validar — travar depois de ler é não travar.
  PERFORM 1 FROM portal.demands WHERE id = p_demand_id FOR UPDATE;

  -- Lista vazia significaria "o ClickUp não tem assignee nenhum" → aplicar seria
  -- ESVAZIAR demand_operators automaticamente. É literalmente a forma do apagão de
  -- 03/09. Recusa: remoção total é decisão de gente, pelo painel.
  IF p_clickup_user_ids IS NULL OR array_length(p_clickup_user_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Lista de assignees vazia — recusado. Esvaziar os responsáveis de uma demanda não é automatizável (ver bug destrutivo de 03/09/2026); use o painel.'
      USING ERRCODE = '22023';
  END IF;

  -- portal.operators.clickup_user_id é TEXT (migration 016), não numérico. O parâmetro
  -- chega como bigint[] (é o tipo natural do id do ClickUp e evita que o chamador
  -- mande "123abc"), e a comparação é feita em text — mesma convenção do
  -- `o.clickup_user_id::text = ANY(...)` da 086. Fazer o contrário (cast da coluna para
  -- bigint) quebraria em qualquer linha com valor não-numérico e não usaria índice
  -- nenhum (não há índice em clickup_user_id — 11 linhas, Seq Scan é o plano certo).
  SELECT array_agg(DISTINCT x::text) INTO v_ids_text
    FROM unnest(p_clickup_user_ids) AS x;

  -- ── PASSO 1: RESOLVER ────────────────────────────────────────────────────
  -- Quais desses IDs têm operador ATIVO cadastrado. status='active' é exigência da
  -- decisão 4: reatribuir automaticamente para alguém inativo/suspenso seria dar
  -- trabalho a quem saiu.
  SELECT array_agg(o.id), array_agg(o.clickup_user_id)
    INTO v_matched_ops, v_matched_cids
    FROM portal.operators o
   WHERE o.clickup_user_id = ANY (v_ids_text)
     AND o.status = 'active';

  -- ── PASSO 2: VALIDAR — ANTES DE TOCAR EM QUALQUER LINHA ──────────────────
  SELECT array_agg(cid) INTO v_unmatched
    FROM unnest(v_ids_text) AS cid
   WHERE NOT (cid = ANY (COALESCE(v_matched_cids, ARRAY[]::text[])));

  IF v_matched_ops IS NULL OR array_length(v_matched_ops, 1) IS NULL THEN
    RAISE EXCEPTION 'Nenhum assignee do ClickUp tem operador ativo cadastrado (sem correspondência: %). Nada foi alterado.', v_unmatched
      USING ERRCODE = 'P0001';
  END IF;

  -- Casamento PARCIAL também reprova: aplicar só os que casaram deixaria de fora quem
  -- o ClickUp diz que é responsável, e o banco ficaria com um estado que não é nem o
  -- do portal nem o do ClickUp. TODOS ou NENHUM.
  IF v_unmatched IS NOT NULL AND array_length(v_unmatched, 1) > 0 THEN
    RAISE EXCEPTION 'Assignee(s) do ClickUp sem operador ativo cadastrado: %. Cadastre-os (ou corrija o clickup_user_id) antes de aplicar. Nada foi alterado.', v_unmatched
      USING ERRCODE = 'P0001';
  END IF;

  -- Snapshot do ANTES, para o audit_log. Depois do ponto de validação e antes da
  -- escrita — é o último instante em que o estado antigo ainda existe.
  SELECT array_agg(o.name ORDER BY o.name) INTO v_before
    FROM portal.demand_operators dop
    JOIN portal.operators o ON o.id = dop.operator_id
   WHERE dop.demand_id = p_demand_id;

  -- ── PASSO 3: APLICAR (validação já passou) ───────────────────────────────
  -- INSERT antes do DELETE de propósito: se por qualquer motivo o DELETE falhasse, a
  -- demanda ficaria com responsáveis a mais — nunca com zero.
  WITH ins AS (
    INSERT INTO portal.demand_operators (demand_id, operator_id, role)
    SELECT p_demand_id, op_id, 'operator'
      FROM unnest(v_matched_ops) AS op_id
     WHERE NOT EXISTS (
       SELECT 1 FROM portal.demand_operators d2
        WHERE d2.demand_id = p_demand_id AND d2.operator_id = op_id
     )
    RETURNING 1
  )
  SELECT count(*) INTO v_added FROM ins;

  -- DELETE dos que o ClickUp não tem mais. Escopo restrito a ESTA demanda e a
  -- operadores que NÃO estão na lista validada.
  WITH del AS (
    DELETE FROM portal.demand_operators
     WHERE demand_id = p_demand_id
       AND NOT (operator_id = ANY (v_matched_ops))
    RETURNING 1
  )
  SELECT count(*) INTO v_removed FROM del;

  -- Estes operadores ESTÃO como assignee real no ClickUp (foi de lá que a lista veio),
  -- então o delivery por operador é 'delivered' — senão o painel mostraria "não
  -- entregue" para gente que está visivelmente atribuída na task.
  UPDATE portal.demand_operators
     SET clickup_delivery = 'delivered', clickup_delivery_at = now()
   WHERE demand_id = p_demand_id;

  -- Convergiu: o banco agora reflete o ClickUp. Estado 'ok', detail limpo — mesma
  -- semântica do ramo !diverged do webhook e do accept_clickup da 086.
  UPDATE portal.demands
     SET clickup_assignee_sync = 'ok',
         clickup_assignee_detail = '{}'::jsonb
   WHERE id = p_demand_id;

  SELECT array_agg(o.name ORDER BY o.name) INTO v_after
    FROM portal.demand_operators dop
    JOIN portal.operators o ON o.id = dop.operator_id
   WHERE dop.demand_id = p_demand_id;

  -- Trilha. user_id NULL: não há usuário logado — quem decidiu foi o ClickUp.
  -- Evento próprio (não reusa demand_assignee_divergence_resolved) justamente para
  -- ser possível medir depois quantas reconciliações foram AUTOMÁTICAS, e auditar
  -- todas de uma vez se a decisão 4 precisar ser revista.
  INSERT INTO portal.audit_log (event, user_id, identifier, metadata)
  VALUES (
    'demand_assignee_auto_reconciled',
    NULL,
    p_demand_id::text,
    jsonb_build_object(
      'before', coalesce(to_jsonb(v_before), '[]'::jsonb),
      'after',  coalesce(to_jsonb(v_after),  '[]'::jsonb),
      'clickup_user_ids', to_jsonb(v_ids_text),
      'operators_applied', coalesce(array_length(v_matched_ops, 1), 0),
      'added', v_added,
      'removed', v_removed,
      'source', 'clickup_webhook'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'demand_id', p_demand_id,
    'operators_applied', coalesce(array_length(v_matched_ops, 1), 0),
    'added', v_added,
    'removed', v_removed
  );
END;
$function$;

-- ── Permissões ─────────────────────────────────────────────────────────────
-- Função nova em schema exposto NASCE PÚBLICA: o Postgres concede EXECUTE a PUBLIC
-- por padrão, e PostgREST expõe portal.* — sem o REVOKE abaixo, qualquer anon com a
-- anon key poderia reescrever os responsáveis de qualquer demanda. É a função mais
-- perigosa deste lote (escreve em demand_operators); fechar é obrigatório.
--
-- ⚠️ REVOKE ... FROM anon NÃO BASTA e não é o que fecha a porta: a permissão vem de
-- PUBLIC, e revogar de um papel que a herda de PUBLIC não tem efeito nenhum — o
-- GRANT continua valendo via PUBLIC. É o REVOKE FROM PUBLIC que fecha. Os REVOKEs de
-- anon/authenticated ficam explícitos por serem baratos e cobrirem o caso de alguém
-- ter dado um GRANT direto a esses papéis no futuro.
REVOKE ALL ON FUNCTION portal.apply_clickup_assignees(uuid, bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION portal.apply_clickup_assignees(uuid, bigint[]) FROM anon;
REVOKE ALL ON FUNCTION portal.apply_clickup_assignees(uuid, bigint[]) FROM authenticated;

-- service_role só: o único chamador é a edge clickup-webhook, que usa a service key.
-- Admin NÃO recebe EXECUTE de propósito — o caminho manual do admin continua sendo
-- portal.admin_resolve_assignee_divergence (que valida is_admin() e pede confirmação
-- nominal na tela). Duas portas para a mesma escrita seria uma a mais para auditar.
GRANT EXECUTE ON FUNCTION portal.apply_clickup_assignees(uuid, bigint[]) TO service_role;

COMMENT ON FUNCTION portal.apply_clickup_assignees(uuid, bigint[]) IS
  'Aplica em portal.demand_operators o conjunto de assignees que está REAL no ClickUp
   (decisão 4 do Marcio, 24/09/2026 — reconciliação automática member→member).
   Serializada por demanda (SELECT ... FOR UPDATE antes de resolver/validar): sem o
   lock, dois eventos concorrentes do webhook para a mesma task zeravam
   demand_operators em READ COMMITTED, com sync=ok e sem exceção.
   Transação única: resolve os IDs → VALIDA todos (RAISE e nada é tocado se sobrar
   qualquer um sem operador ATIVO cadastrado) → só então INSERT dos novos + DELETE dos
   ausentes. A ordem valida-antes-de-apagar é a correção do bug destrutivo de
   03/09/2026 — não inverter. Recusa lista vazia (esvaziar responsáveis não é
   automatizável). Marca clickup_delivery=delivered, demands.clickup_assignee_sync=ok,
   detail={} e grava audit_log demand_assignee_auto_reconciled com before/after.
   NÃO chama _resync_demand_assignees: o ClickUp é a fonte aqui, devolver o estado para
   lá seria um loop. Chamador único: edge clickup-webhook v5 (service_role).';
