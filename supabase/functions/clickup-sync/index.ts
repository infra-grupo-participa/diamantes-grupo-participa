// clickup-sync v15 — hierarquia Pasta(aluno) → Lista(projeto/avulsas) → Tarefa(demanda).
// portal.demands (INSERT/UPDATE) → trigger pg_net (portal._sync_demand_to_clickup)
// → esta função cria/atualiza a task no ClickUp e grava demands.clickup_task_id.
// Ações extras: {action:"provision_structure"} cria pastas/listas em lote;
// {action:"ensure_project_list", project_id} garante e devolve a lista do projeto;
// {action:"reconcile_assignees", limit?, after?} varre demandas com clickup_task_id e popula
// clickup_assignee_sync/detail + demand_operators.clickup_delivery sem escrever no
// ClickUp (ação manual, migration 086).
//
// v13 (086, revisão pós-teste real na API — 2026-09-01): multiple_assignees JÁ ESTÁ
// LIGADO no espaço 901313801473 (confirmado pelo coordenador com task real de 5
// assignees, ClickUp aceitou 3). spaceAllowsMultipleAssignees() continua existindo —
// é o que detecta isso e mantém o fallback de 1 assignee se algum dia for desligado —
// mas o problema real NÃO é capability do espaço, é o papel GUEST de 2 operadores
// (Caio Marcondes cu=84118999, Manuela Rios cu=84099161 — decisão do Marcio: MANTER
// como guest, não converter).
//
// Guest não pode ser assignee (ITEM_087) NEM watcher: POST /task/{id}/watcher NÃO
// EXISTE na API v2 (404 — a v12 presumiu esse endpoint errado, removido nesta versão),
// e PUT /task/{id} com watchers.add para guest dá ITEM_096 "must have access to all
// lists". E o pior: quando a lista de assignees MISTURA member+guest, o ClickUp
// **aceita com HTTP 200 e descarta o guest em silêncio** — sem ITEM_087, sem erro
// nenhum. Por isso a detecção deixou de ser por catch de exceção e passou a ser por
// COMPARAÇÃO: depois de criar/atualizar a task, compara quem foi PEDIDO
// (assigneesFor(members)) com quem voltou de fato em task.assignees, e classifica a
// causa de cada ausente (guest_cannot_assign / no_clickup_user / space_single_assignee)
// consultando um cache de papéis do workspace (GET /team, role 4 = guest, TTL 1h,
// mesmo padrão do cache de space). 'guest_cannot_assign' é marcado como
// clickup_assignee_detail.permanent=true e clickup_assignee_sync='partial_expected' —
// é um estado ESPERADO enquanto a decisão for manter guest, não uma falha a corrigir,
// e por isso o e-mail ao admin só dispara na primeira detecção (ver clickup-webhook).
//
// v14 (086/087, revisão do arquiteto 2026-09-03 — ANTES de qualquer deploy real):
//   - reconcileAssignees agora pagina (limit default 25 + cursor `after`/`next_cursor`):
//     sem isso, 1.500 demandas × 350ms de throttle estoura os 150s de timeout da Edge
//     Function E perde todo o trabalho por não ter cursor (hoje passa com 15 linhas —
//     não passaria com 10x mais linha, que é exatamente o caso a testar).
//   - persistAssigneeSync agora também grava demand_operators.clickup_delivery por
//     operador (delivered/blocked_guest/blocked_other/no_clickup_user) — sem isso,
//     "quais demandas a Manuela não recebeu" exigia varrer clickup_assignee_detail
//     (jsonb) linha a linha.
//   - classifyMissingReason: operador sem clickup_user_id era FILTRADO por
//     expectedOpsFor ANTES da comparação — a razão 'no_clickup_user' nunca existia de
//     fato (lixeira). Agora esses operadores entram como missing/no_clickup_user, e o
//     cache de GET /team (já buscado para guest) também distingue stale_clickup_user
//     (ID cadastrado mas não existe mais no workspace — fantasma) de unknown_rejected.
//   - fetchCurrentAssignees/fetchCurrentAssigneesFull eram 2 GETs /task idênticos com
//     projeções diferentes — unificados em fetchTask (1 chamada, 2 leituras).
//   - notifyAdminDivergence extraída para _shared/notify-admin-divergence.ts (estava
//     duplicada literalmente em clickup-webhook).
//   - setConfig agora console.warn explícito em falha (antes engolia em silêncio —
//     se o cache nunca gravasse, batia no ClickUp em toda invocação sem ninguém notar).
//
// v15 (089/090/091, 2026-09-24 — plano definitivo de atribuição de responsáveis):
//   - PASSO 3: getTeamRoles agora PROJETA o resultado do /team em
//     portal.operators.clickup_notifiable (syncNotifiableFromTeam). A coluna era órfã
//     desde a 087 — o COMMENT prometia manutenção automática e nenhum código escrevia
//     nela, então guest NOVO nunca era marcado e nunca recebia o e-mail de
//     substituição. Só escreve no caminho de REVALIDAÇÃO (fetch real do /team com
//     sucesso) e nunca com `members` vazio — ver a guarda na própria função.
//   - PASSO 5: reconcile_assignees aceita {all:true} e encadeia lotes internamente
//     (até 4 × limit) devolvendo `batches`/`stopped_reason`. O cron da migration 090
//     dispara UMA chamada HTTP e não tem quem leia o next_cursor para continuar.
//   - reconcileAssignees PULA demandas em 'external_*' (conta em skipped_external).
//     Era o conflito 4 do plano: sem isso o cron diário reclassificaria como
//     'partial'/'none' as demandas que o webhook marcou como perda/troca/reforço,
//     anulando o split do passo 2 todo dia às 04:00 em silêncio.
//   - persistAssigneeSync: `sync !== "external"` virou `!sync.startsWith("external")`
//     — com o split, o literal deixava os 3 estados novos dispararem e-mail por aqui.
//
// v16 (migration 095, 2026-09-25 — briefing de vídeo + prazo remarcável no ClickUp):
//   - CRIAÇÃO: demanda editor-video com briefing → `markdown_content` = texto do
//     cliente + portal.video_briefing_markdown(briefing, due_suggested_at) (tudo do
//     briefing no card). due_date vem de due_at (com hora: due_date_time); demanda
//     antiga sem due_at continua pelo ends_at ao meio-dia UTC.
//   - ATUALIZAÇÃO: NÃO manda mais due_date/start_date (após criada, o prazo é do
//     ClickUp — a equipe remarca lá) nem description de demanda com briefing (o card é
//     o markdown gerado; mandar demands.description apagaria o briefing do card).
//   - VARREDURA (reconcile_assignees, cron 04:00): reaproveita o GET /task que já
//     fazia e, se o prazo do ClickUp difere de due_at, chama
//     portal.apply_clickup_due_change (source 'sweep'). Zero chamada extra ao ClickUp.
//
// ⚠️ Fonte da verdade vive no Supabase (deploy via `supabase functions deploy`).
// Este arquivo é a cópia versionada — mantenha em sincronia ao editar a função.
//
// ✅ DIFF CONTRA O REMOTO FEITO EM 2026-09-24: a v14 em produção foi baixada e
// conferida idêntica a esta cópia do repo antes da edição da v15. O aviso "NÃO FAÇA
// DEPLOY sem diffar" que vivia aqui desde 03/09 foi removido por estar cumprido —
// ver supabase/functions/README.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyAdminDivergence as notifyAdminDivergenceShared } from "../_shared/notify-admin-divergence.ts";

const CLICKUP_API  = "https://api.clickup.com/api/v2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Mapping portal.demands.status → status PT-BR do ClickUp
function mapStatus(s: string): string {
  switch (s) {
    case "open":         return "aberta";
    case "in_progress":  return "em andamento";
    case "review":       return "em revisão";
    case "done":         return "concluída";
    case "canceled":     return "cancelado";
    default:             return "aberta";
  }
}

async function getSecret(supabase: any, name: string): Promise<string> {
  const { data, error } = await supabase.schema("portal")
    .rpc("get_internal_secret", { p_name: name });
  if (error) throw new Error(`secret ${name}: ${error.message}`);
  return data || "";
}

async function getConfig(supabase: any) {
  const { data, error } = await supabase.schema("portal").from("clickup_config").select("key, value");
  if (error) throw new Error("Config: " + error.message);
  return Object.fromEntries((data || []).map((r: any) => [r.key, r.value]));
}

// Grava uma chave de cache em clickup_config. Falha aqui não é inócua: se o UPSERT
// nunca gravar (RLS, typo de coluna, etc.), o cache nunca esquenta e toda invocação
// volta a bater no ClickUp (GET /space, GET /team) sem que ninguém perceba — daí o
// console.warn explícito (antes engolia em console.error solto, fácil de nunca notar
// nos logs). Best-effort: não propaga (cache é otimização, não requisito).
async function setConfig(supabase: any, key: string, value: string) {
  const { error } = await supabase.schema("portal").from("clickup_config")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) {
    console.warn(`setConfig FALHOU para "${key}" — cache não vai esquentar, próximas chamadas batem direto no ClickUp:`, error.message);
  }
}

const MULTI_ASSIGNEE_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

// Capability do espaço: multiple_assignees ligado ou desligado no ClickApp.
// Cache em clickup_config.space_multi_assignee_cache (jsonb-as-text: "true"/"false"
// + timestamp), TTL 1h — evita bater GET /space a cada createTask/updateTask.
// Falha na consulta → assume FALSE (conservador: prefere fallback de 1 assignee a ITEM_417).
async function spaceAllowsMultipleAssignees(supabase: any, apiKey: string, cfg: any): Promise<boolean> {
  const raw = cfg.space_multi_assignee_cache || "";
  if (raw) {
    try {
      const cached = JSON.parse(raw);
      if (cached && typeof cached.value === "boolean" && Date.now() - Number(cached.at || 0) < MULTI_ASSIGNEE_CACHE_TTL_MS) {
        return cached.value;
      }
    } catch (_) { /* cache corrompido/formato antigo — revalida */ }
  }
  if (!cfg.space_id) return false;
  try {
    const space = await clickupRequest(apiKey, `/space/${cfg.space_id}`);
    // Campo top-level (confirmado via GET /space real): { ..., "multiple_assignees": bool }.
    // NÃO fica em features.multiple_assignees.enabled.
    const value = space?.multiple_assignees === true;
    await setConfig(supabase, "space_multi_assignee_cache", JSON.stringify({ value, at: Date.now() }));
    return value;
  } catch (e) {
    console.error("spaceAllowsMultipleAssignees GET /space falhou — assumindo false", (e as any)?.message || e);
    return false;
  }
}

// ⚠️ NÃO EXISTE POST /task/{id}/watcher na API v2 do ClickUp (404 — testado real
// pelo coordenador). E mesmo se existisse um caminho de watcher (PUT /task com
// watchers.add), guest dá ITEM_096 "must have access to all lists of the task".
// Watcher NÃO é fallback para guest. Removido nesta versão (v13) — não recriar.

const ROLE_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — mesmo TTL do cache de space.
const GUEST_ROLE = 4; // GET /team: user.role === 4 é guest (confirmado real).

// Cache de "quem é membro real do workspace hoje" (GET /team), em
// clickup_config.guest_clickup_ids_cache (jsonb-as-text: {ids:number[], members:number[], at}).
// `ids` = guests (role 4) — usado para CLASSIFICAR causa de ausência (guest_cannot_assign).
// `members` = todos os IDs vistos no /team (member ou guest) — usado para distinguir
// stale_clickup_user (cadastrado mas não existe mais no workspace) de unknown_rejected
// (existe no workspace, não é guest, e mesmo assim não virou assignee — causa desconhecida).
// v15 / passo 3 (2026-09-24) — portal.operators.clickup_notifiable vira PROJEÇÃO do
// GET /team, não mais um campo editado à mão.
//
// Por que existia o problema: o COMMENT da migration 087 prometia que a coluna era
// "mantida pela reconciliação", mas NENHUM código escrevia nela — `grep update|upsert|
// insert` nas edges dava vazio. Os dois `false` de produção eram edição manual de
// 03/09. Consequência: guest NOVO nunca era marcado, a trigger
// demand_operators_notify_guest nunca disparava para ele, e ele não recebia nem
// notificação do ClickUp (guest não pode ser assignee) nem e-mail do portal —
// passivo crescendo calado, 8→10 vínculos em 21 dias.
//
// ⚠️ GUARDAS (a parte que importa). São DUAS, e a segunda é a que pega o caso difícil:
//   (i)  esta função SÓ é chamada no caminho em que o fetch real do /team RETORNOU COM
//        SUCESSO, e ainda assim recusa escrever se `members` veio vazio. Um /team que
//        falha devolve Set vazio, e Set vazio é indistinguível de "workspace sem
//        guests" — escrever aí marcaria TODO MUNDO como notifiable=true e desligaria o
//        e-mail de guest da operação inteira, em silêncio.
//   (ii) `true` só por AFIRMAÇÃO POSITIVA (o ID está PRESENTE em memberIds), nunca por
//        exclusão. A guarda (i) sozinha não cobre resposta 200 PARCIAL — paginação ou
//        degradação do ClickUp devolvendo um subconjunto do workspace. Nesse caso um
//        guest ausente da resposta não entra em guestIds e, se o filtro fosse "não é
//        guest logo é member", viraria notifiable=true. Quem não aparece no /team desta
//        resposta NÃO É TOCADO. (achado do kirad, 24/09/2026)
// Nos dois casos a regra é a mesma: sem dado, não se escreve.
//
// Os 2 UPDATEs usam IS DISTINCT FROM: a 2ª execução seguida tem que afetar 0 linhas
// (é o que o EXPLAIN do passo 3 prova). Sem isso, a coluna updated_at/triggers seriam
// tocadas de hora em hora sem mudança nenhuma de valor.
async function syncNotifiableFromTeam(supabase: any, guestIds: number[], memberIds: number[]) {
  if (!memberIds.length) {
    console.warn("syncNotifiableFromTeam: /team sem members — NÃO escrevendo clickup_notifiable (vazio ≠ sem guests)");
    return;
  }
  try {
    // operators.clickup_user_id é TEXT (migration 016) — comparar com strings.
    const guestText = new Set(guestIds.map((n) => String(n)));

    // Lê os 11 operadores cadastrados e decide em memória quem precisa mudar. Fazer o
    // "NOT IN (guests)" direto no PostgREST exigiria interpolar a lista numa string de
    // filtro (`not.in.(...)`), que quebra com aspas/vírgula no valor — com uma tabela
    // de 11 linhas, ler e comparar aqui é mais barato de entender e impossível de
    // injetar. Escala: se um dia forem 10 mil operadores, isto vira 2 UPDATEs por SQL.
    const { data: ops, error: readErr } = await supabase.schema("portal")
      .from("operators").select("id, clickup_user_id, clickup_notifiable")
      .not("clickup_user_id", "is", null);
    if (readErr) { console.error("syncNotifiableFromTeam read err", readErr.message); return; }

    // (1) guests do /team que ainda não estão false → false
    const toFalse = (ops || [])
      .filter((o: any) => guestText.has(String(o.clickup_user_id)) && o.clickup_notifiable !== false)
      .map((o: any) => o.id);
    // (2) → true SÓ por AFIRMAÇÃO POSITIVA: o operador tem que estar PRESENTE em
    // memberIds (foi visto no /team desta resposta) e não ser guest. Nunca por
    // exclusão ("não está na lista de guests, logo é member").
    //
    // ⚠️ Achado do kirad (24/09/2026): a guarda de `!memberIds.length` só cobre
    // resposta VAZIA. Uma resposta 200 PARCIAL (paginação, degradação do ClickUp) traz
    // menos gente do que o workspace tem — um guest ausente dessa resposta não entra em
    // guestIds, e com o filtro por exclusão cairia em toTrue e seria marcado
    // clickup_notifiable=true. Dois estragos de uma vez: o e-mail de substituição
    // (demand_operators_notify_guest) para de sair para ele, e a barreira (c) do
    // tryAutoReconcile no webhook deixa de reconhecê-lo como guest — passando a
    // AUTO-APLICAR trocas que envolvem guest, que é justamente o que a decisão 4
    // exclui. Operador não visto no /team fica INTOCADO: sem dado, não se escreve.
    const memberText = new Set(memberIds.map((n) => String(n)));
    const toTrue = (ops || [])
      .filter((o: any) => {
        const cid = String(o.clickup_user_id);
        return memberText.has(cid) && !guestText.has(cid) && o.clickup_notifiable !== true;
      })
      .map((o: any) => o.id);

    // Os dois UPDATEs só tocam linhas que REALMENTE mudam de valor (o filtro acima é o
    // IS DISTINCT FROM): rodar duas vezes seguidas afeta 0 linhas na 2ª.
    if (toFalse.length) {
      const { error: gErr } = await supabase.schema("portal").from("operators")
        .update({ clickup_notifiable: false }).in("id", toFalse);
      if (gErr) console.error("syncNotifiableFromTeam guests err", gErr.message);
    }
    if (toTrue.length) {
      const { error: mErr } = await supabase.schema("portal").from("operators")
        .update({ clickup_notifiable: true }).in("id", toTrue);
      if (mErr) console.error("syncNotifiableFromTeam members err", mErr.message);
    }
    // `untouched` = operadores com clickup_user_id que NÃO apareceram nesta resposta do
    // /team. Em operação normal é 0. Valor alto e persistente é o sintoma de resposta
    // parcial (ou de cadastro com ID fantasma) — é o que torna a guarda (ii) visível
    // nos logs em vez de silenciosa.
    const untouched = (ops || []).filter(
      (o: any) => !memberText.has(String(o.clickup_user_id)),
    ).length;
    if (toFalse.length || toTrue.length || untouched) {
      console.log(
        `syncNotifiableFromTeam: ${toFalse.length} → false, ${toTrue.length} → true, ${untouched} não vistos no /team (intocados)`,
      );
    }
  } catch (e) {
    // Best-effort: manter a coluna é diagnóstico/roteamento de e-mail, nunca pode
    // derrubar a sincronização de assignees (lição das migrations 032/054/055).
    console.error("syncNotifiableFromTeam threw", (e as any)?.message || e);
  }
}

async function getTeamRoles(supabase: any, apiKey: string, cfg: any): Promise<{ guestIds: Set<number>; memberIds: Set<number> }> {
  const raw = cfg.guest_clickup_ids_cache || "";
  if (raw) {
    try {
      const cached = JSON.parse(raw);
      if (cached && Array.isArray(cached.ids) && Date.now() - Number(cached.at || 0) < ROLE_CACHE_TTL_MS) {
        return {
          guestIds: new Set<number>(cached.ids),
          memberIds: new Set<number>(Array.isArray(cached.members) ? cached.members : cached.ids),
        };
      }
    } catch (_) { /* cache corrompido/formato antigo — revalida */ }
  }
  if (!cfg.team_id) return { guestIds: new Set<number>(), memberIds: new Set<number>() };
  try {
    const resp = await clickupRequest(apiKey, `/team`);
    const team = (resp?.teams || []).find((t: any) => String(t.id) === String(cfg.team_id));
    const allMembers = ((team?.members || []) as any[]);
    const ids = allMembers
      .filter((m) => Number(m?.user?.role) === GUEST_ROLE)
      .map((m) => Number(m.user.id))
      .filter((n) => !isNaN(n));
    const members = allMembers
      .map((m) => Number(m?.user?.id))
      .filter((n) => !isNaN(n));
    await setConfig(supabase, "guest_clickup_ids_cache", JSON.stringify({ ids, members, at: Date.now() }));
    // v15 (passo 3): o /team acabou de responder com sucesso — é o único momento em que
    // se sabe a verdade sobre quem é guest hoje. Projeta isso em operators.clickup_notifiable.
    await syncNotifiableFromTeam(supabase, ids, members);
    return { guestIds: new Set(ids), memberIds: new Set(members) };
  } catch (e) {
    console.error("getTeamRoles GET /team falhou — sem classificação de guest/stale nesta chamada", (e as any)?.message || e);
    return { guestIds: new Set<number>(), memberIds: new Set<number>() };
  }
}

// Classifica a causa de um operador esperado que NÃO apareceu em task.assignees
// (detectado por COMPARAÇÃO — é o caminho principal, não catch de exceção: o ClickUp
// aceita HTTP 200 e descarta guest em silêncio quando a lista mistura member+guest).
//   no_clickup_user     = o operador nunca teve clickup_user_id cadastrado (não dá
//                         pra saber "por que não foi assignee" — nunca foi mandado).
//   guest_cannot_assign = ID cadastrado, é guest confirmado no /team (permanente).
//   stale_clickup_user  = ID cadastrado mas NÃO aparece no /team (fantasma — ex.
//                         Gabriel Alves 230453991, cadastro desatualizado).
//   space_single_assignee = espaço sem multi-assignee (fallback já cobre o caso comum,
//                         isto é só para o raro caso de ainda sobrar >1 esperado).
//   unknown_rejected    = existe no /team, não é guest, e mesmo assim não colou —
//                         causa desconhecida, fica pra investigação manual.
function classifyMissingReason(
  clickupUserId: number | null,
  guestIds: Set<number>,
  memberIds: Set<number>,
  multiAllowed: boolean,
): string {
  if (clickupUserId === null) return "no_clickup_user";
  if (guestIds.has(clickupUserId)) return "guest_cannot_assign";
  if (!memberIds.has(clickupUserId)) return "stale_clickup_user";
  if (!multiAllowed) return "space_single_assignee";
  return "unknown_rejected";
}

// Compara quem foi PEDIDO (expectedOps: [{id,name}]) com quem voltou de fato na
// resposta do ClickUp (task.assignees) e monta o estado final. Esta é a fonte da
// verdade sobre o que realmente aconteceu — response-diffing, não pré-cálculo.
//   - nenhum ausente                              → 'ok'
//   - todos ausentes por guest (permanente)        → 'partial_expected' (permanent:true)
//   - mistura de guest + outra causa, ou só outra  → 'partial' (não-permanente)
//   - nenhum operador esperado chegou               → 'none'
//
// expectedOps.clickup_user_id é number|null agora (v14): operador SEM clickup_user_id
// entra na lista (antes era filtrado antes de chegar aqui — 'no_clickup_user' nunca
// existia de fato). Esses nunca podem estar em actualAssignees (não têm id numérico
// pra achar lá), então sempre contam como missing.
function buildAssigneeSyncState(
  expectedOps: Array<{ operator_id: string; clickup_user_id: number | null; name: string | null }>,
  actualAssignees: Array<{ id: number; name: string }>,
  guestIds: Set<number>,
  memberIds: Set<number>,
  multiAllowed: boolean,
): { sync: string; detail: Record<string, unknown>; perOperator: Array<{ operator_id: string; delivery: string }> } {
  if (expectedOps.length === 0) return { sync: "ok", detail: {}, perOperator: [] };
  const actualIds = new Set(actualAssignees.map((a) => a.id));
  const missing = expectedOps.filter((o) => o.clickup_user_id === null || !actualIds.has(o.clickup_user_id));

  const perOperator = expectedOps.map((o) => {
    const delivered = o.clickup_user_id !== null && actualIds.has(o.clickup_user_id);
    if (delivered) return { operator_id: o.operator_id, delivery: "delivered" };
    const reason = classifyMissingReason(o.clickup_user_id, guestIds, memberIds, multiAllowed);
    const delivery = reason === "no_clickup_user" ? "no_clickup_user"
      : reason === "guest_cannot_assign" ? "blocked_guest"
      : "blocked_other";
    return { operator_id: o.operator_id, delivery };
  });

  if (missing.length === 0) return { sync: "ok", detail: {}, perOperator };

  const missingWithReason = missing.map((o) => ({
    name: o.name,
    clickup_user_id: o.clickup_user_id,
    reason: classifyMissingReason(o.clickup_user_id, guestIds, memberIds, multiAllowed),
  }));
  const allPermanentGuest = missingWithReason.every((m) => m.reason === "guest_cannot_assign");
  const sentNames = expectedOps.filter((o) => o.clickup_user_id !== null && actualIds.has(o.clickup_user_id)).map((o) => o.name).filter(Boolean);

  const detail = {
    sent: sentNames,
    missing: missingWithReason,
    permanent: allPermanentGuest,
  };

  if (missing.length === expectedOps.length && !allPermanentGuest) {
    return { sync: "none", detail, perOperator };
  }
  // 'partial_expected': divergência 100% explicada por guest — estado ESPERADO
  // enquanto a decisão for manter guest (não é falha a corrigir). 'partial': tem
  // pelo menos 1 ausência por outro motivo — essa sim é acionável pelo admin.
  return { sync: allPermanentGuest ? "partial_expected" : "partial", detail, perOperator };
}

// Alerta de divergência ao admin (extraído para _shared — estava duplicado
// literalmente em clickup-webhook, ver migration 086/087 revisão 2026-09-03).
async function notifyAdminDivergence(supabase: any, cfg: any, demand_id: string, sent: string[], missing: string[]) {
  await notifyAdminDivergenceShared(supabase, SUPABASE_URL, getSecret, cfg, demand_id, "sync", sent, missing);
}

// Grava o estado de sync de assignees na demanda + o delivery por operador em
// demand_operators.clickup_delivery (v14 — antes só o resumo da demanda existia,
// sem granularidade por operador). SÓ LOGA em falha — diagnóstico nunca derruba a
// operação principal (lição das migrations 032/054/055).
//
// Alerta por e-mail: dispara SÓ quando o estado muda PARA 'partial'/'partial_expected'/
// 'none' vindo de um estado diferente (primeira detecção) — nunca a cada chamada, senão
// vira spam diário para o mesmo caso conhecido (guest permanente sobretudo). Lê o estado
// anterior antes de sobrescrever, propositalmente síncrono (é 1 SELECT extra, tabela
// tem 15 linhas — sem custo real).
async function persistAssigneeSync(
  supabase: any, cfg: any, demand_id: string, sync: string, detail: Record<string, unknown>,
  perOperator: Array<{ operator_id: string; delivery: string }>,
) {
  try {
    const { data: prev } = await supabase.schema("portal").from("demands")
      .select("clickup_assignee_sync").eq("id", demand_id).maybeSingle();
    const wasDivergent = prev?.clickup_assignee_sync && prev.clickup_assignee_sync !== "ok";
    // v15: o estado 'external' virou três ('external_loss'/'external_reassigned'/
    // 'external_added', migration 089) — o `!== "external"` literal deixava os três
    // novos passarem por aqui e mandarem e-mail pelo caminho do SYNC, duplicando o
    // alerta que o webhook já decide mandar (e mandando também nos casos que a decisão
    // de 24/09 mandou parar de alertar). Prefixo, não igualdade.
    const isDivergentNow = sync !== "ok" && !sync.startsWith("external"); // 'external*' é alertado pelo webhook, não aqui

    const { error } = await supabase.schema("portal").from("demands")
      .update({ clickup_assignee_sync: sync, clickup_assignee_detail: detail }).eq("id", demand_id);
    if (error) { console.error("persistAssigneeSync update err", demand_id, error.message); return; }

    // Grava clickup_delivery por operador (best-effort — 1 UPDATE por operador,
    // tabela tem no máx. 3-4 linhas por demanda, sem custo real).
    const nowIso = new Date().toISOString();
    for (const op of perOperator) {
      const { error: opErr } = await supabase.schema("portal").from("demand_operators")
        .update({ clickup_delivery: op.delivery, clickup_delivery_at: nowIso })
        .eq("demand_id", demand_id).eq("operator_id", op.operator_id);
      if (opErr) console.error("persistAssigneeSync demand_operators err", demand_id, op.operator_id, opErr.message);
    }

    if (isDivergentNow && !wasDivergent) {
      const sent = (detail as any)?.sent as string[] | undefined;
      const missing = ((detail as any)?.missing as Array<{ name?: string | null }> | undefined) || [];
      await notifyAdminDivergence(supabase, cfg, demand_id, sent || [], missing.map((m) => m.name || "").filter(Boolean));
    }
  } catch (e) {
    console.error("persistAssigneeSync threw", demand_id, (e as any)?.message || e);
  }
}

async function getDemand(supabase: any, demand_id: string) {
  const { data, error } = await supabase.schema("portal")
    .from("demands").select("*").eq("id", demand_id).maybeSingle();
  if (error) throw new Error("Demand: " + error.message);
  return data;
}

// Operadores atribuídos vivem em portal.demand_operators (NÃO demand_members,
// que só tem role='client'). portal.operators já tem clickup_user_id.
// (v6: corrige assignees vazios — antes lia demand_members.)
async function getMembersInfo(supabase: any, demand_id: string) {
  const { data: dops } = await supabase.schema("portal")
    .from("demand_operators").select("operator_id").eq("demand_id", demand_id);
  if (!dops?.length) return [];
  const opIds = dops.map((d: any) => d.operator_id);
  const { data: operators } = await supabase.schema("portal")
    .from("operators").select("id, name, email, clickup_user_id").in("id", opIds);
  return (operators || []).map((o: any) => ({
    user_id: o.id, role: "operator",
    user: { name: o.name, email: o.email, clickup_user_id: o.clickup_user_id },
  }));
}

async function getRequesterEmail(supabase: any, created_by: string | null) {
  if (!created_by) return "";
  const { data } = await supabase.schema("portal")
    .from("users").select("email").eq("id", created_by).maybeSingle();
  return data?.email || "";
}

async function clickupRequest(apiKey: string, path: string, init: RequestInit = {}) {
  const doFetch = () => fetch(CLICKUP_API + path, {
    ...init,
    headers: { ...(init.headers || {}), "Authorization": apiKey, "Content-Type": "application/json" },
  });

  let r = await doFetch();
  // Rate limit (429): aguarda o Retry-After (ou um curto delay) e tenta 1 vez.
  if (r.status === 429) {
    const ra = Number(r.headers.get("Retry-After"));
    const delayMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10_000) : 1500;
    await new Promise((res) => setTimeout(res, delayMs));
    r = await doFetch();
  }

  const txt = await r.text();
  let json: any = null; try { json = JSON.parse(txt); } catch (_) { json = txt; }
  if (!r.ok) throw new Error(`ClickUp ${r.status}: ${JSON.stringify(json)}`);
  return json;
}

function buildCustomFields(cfg: any, demand: any, members: any[], requester: string) {
  const opNames = members
    .filter(m => m.role === "operator")
    .map(m => m.user.name || m.user.email).filter(Boolean).join(", ");
  return [
    { id: cfg.field_cliente_slug, value: demand.client_slug || "" },
    { id: cfg.field_solicitante,  value: requester },
    { id: cfg.field_demand_id,    value: demand.id },
    { id: cfg.field_equipe,       value: opNames || "—" },
  ];
}

function assigneesFor(members: any[]): number[] {
  return members
    .filter(m => m.role === "operator" && m.user.clickup_user_id)
    .map(m => Number(m.user.clickup_user_id))
    .filter(n => !isNaN(n));
}

// Nome da task = só o título da demanda. Na hierarquia v10 o PROJETO é a própria
// LISTA (pasta do aluno → lista do projeto), então não há mais prefixo "[Projeto]"
// no nome da task (removido na v10 — o clickup-webhook ainda tem a remoção de
// prefixo como compat de tasks antigas, ver esse arquivo).
function taskName(demand: any): string {
  return demand.title || "Demanda";
}

// Demanda com briefing estruturado (095: hoje só editor-video). Em produção
// demands.briefing é jsonb NOT NULL DEFAULT '{}' — `{}` é truthy em JS e marcaria TODA
// demanda como "com briefing" (desligando o sync de description). Só conta objeto
// com chaves.
function hasBriefing(demand: any): boolean {
  const b = demand?.briefing;
  return !!b && typeof b === "object" && !Array.isArray(b) && Object.keys(b).length > 0;
}

// Card da criação: texto livre do cliente + briefing renderizado NO BANCO
// (portal.video_briefing_markdown — mesma fonte de chaves/rótulos da validação).
// Falha aqui não pode impedir a criação da task: cai para a description pura e loga.
async function buildCreateMarkdown(supabase: any, demand: any): Promise<string | null> {
  if (!hasBriefing(demand) || demand.service_type !== "editor-video") return null;
  const { data, error } = await supabase.schema("portal").rpc("video_briefing_markdown", {
    p: demand.briefing,
    p_due: demand.due_suggested_at || demand.due_at || null,
  });
  if (error || typeof data !== "string" || !data) {
    console.error("video_briefing_markdown falhou — card sem briefing", demand.id, error?.message);
    return null;
  }
  const text = String(demand.description || "").trim();
  return text ? `${text}\n\n---\n\n${data}` : data;
}

function buildCreatePayload(demand: any, assignees: number[], markdown: string | null = null) {
  const p: any = {
    name: taskName(demand),
    description: demand.description || "",
    status: mapStatus(demand.status),
    assignees,
  };
  // ClickUp: com markdown_content E description, vale o markdown_content.
  if (markdown) p.markdown_content = markdown;
  if (demand.starts_at) p.start_date = new Date(demand.starts_at + "T12:00:00Z").getTime();
  if (demand.due_at) {
    // 095: prazo com hora (fonte da verdade). due_date_time liga a exibição da hora.
    p.due_date = Date.parse(demand.due_at);
    p.due_date_time = demand.due_has_time !== false;
  } else if (demand.ends_at) {
    p.due_date = new Date(demand.ends_at + "T12:00:00Z").getTime();
  }
  return p;
}

// Única leitura de GET /task/{id} — antes havia fetchCurrentAssignees (só ids) e
// fetchCurrentAssigneesFull (id+nome) fazendo o MESMO GET com projeções diferentes,
// dobrando a chamada à API por update (v14: unificado).
async function fetchTask(apiKey: string, task_id: string): Promise<any> {
  try {
    return await clickupRequest(apiKey, `/task/${task_id}`);
  } catch (_) { return null; }
}
function assigneeIdsFromTask(task: any): number[] {
  return ((task?.assignees || []) as any[]).map((a: any) => Number(a.id)).filter((n: number) => !isNaN(n));
}

function buildUpdatePayload(demand: any, addAssignees: number[], remAssignees: number[]) {
  const p: any = {
    name: taskName(demand),
    status: mapStatus(demand.status),
  };
  // 095: com briefing, o card é o markdown gerado na criação — demands.description
  // (só o texto livre) o sobrescreveria, apagando o briefing do card.
  if (!hasBriefing(demand)) p.description = demand.description || "";
  // 095: SEM start_date/due_date na atualização. Depois de criada, o prazo é do
  // ClickUp (a equipe remarca lá; o portal só reflete via apply_clickup_due_change).
  // Mandar aqui desfaria a remarcação da equipe a cada update de status/título.
  if (addAssignees.length || remAssignees.length) {
    p.assignees = { add: addAssignees, rem: remAssignees };
  }
  return p;
}

async function setCustomFields(apiKey: string, task_id: string, cfg: any, demand: any, members: any[], requester: string) {
  for (const f of buildCustomFields(cfg, demand, members, requester)) {
    await clickupRequest(apiKey, `/task/${task_id}/field/${f.id}`, {
      method: "POST", body: JSON.stringify({ value: f.value }),
    }).catch(e => console.error("field err", f.id, e.message));
  }
}

// ── Hierarquia 3 camadas: Pasta(aluno) → Lista(projeto | "Avulsas") → Tarefa ──
async function createFolder(apiKey: string, spaceId: string, name: string): Promise<string> {
  const f = await clickupRequest(apiKey, `/space/${spaceId}/folder`, {
    method: "POST", body: JSON.stringify({ name }),
  });
  return String(f.id);
}
async function createList(apiKey: string, folderId: string, name: string): Promise<string> {
  const l = await clickupRequest(apiKey, `/folder/${folderId}/list`, {
    method: "POST", body: JSON.stringify({ name }),
  });
  return String(l.id);
}

// Garante a PASTA do aluno (clients.cu_folder_id) — cria no espaço se faltar.
async function ensureClientFolder(supabase: any, apiKey: string, cfg: any, client_slug: string): Promise<{ folderId: string; client: any } | null> {
  if (!client_slug || !cfg.space_id) return null;
  const { data: client } = await supabase.schema("portal")
    .from("clients").select("slug, display_name, cu_folder_id, cu_inbox_list_id, cu_list_id").eq("slug", client_slug).maybeSingle();
  if (!client) return null;
  let folderId = String(client.cu_folder_id || "").trim();
  if (!folderId) {
    folderId = await createFolder(apiKey, cfg.space_id, (client.display_name || client.slug || "Aluno").trim());
    await supabase.schema("portal").from("clients").update({ cu_folder_id: folderId }).eq("slug", client_slug);
    client.cu_folder_id = folderId;
  }
  return { folderId, client };
}

// Cria uma lista com nome único na pasta: se o nome já existe ("List name taken",
// p.ex. projetos com título duplicado), desambigua com sufixo " (2)", " (3)"...
async function createListUnique(apiKey: string, folderId: string, baseName: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const name = i === 0 ? baseName : `${baseName} (${i + 1})`;
    try {
      return await createList(apiKey, folderId, name);
    } catch (e) {
      const msg = String((e as any)?.message || e);
      if (msg.includes("List name taken") || msg.includes("SUBCAT_016")) continue;
      throw e;
    }
  }
  throw new Error(`createListUnique: nomes esgotados para "${baseName}"`);
}

// Garante a LISTA do projeto (projects.cu_list_id) dentro da pasta do aluno.
// 095 (kirad, baixo): `expectedClientSlug` = client_slug da DEMANDA. Projeto de outro
// cliente (project_id forjado) → loga e devolve "" — o chamador cai na lista do
// próprio cliente, em vez de criar/usar a lista do projeto alheio.
async function ensureProjectList(supabase: any, apiKey: string, folderId: string, project_id: string, expectedClientSlug?: string): Promise<string> {
  const { data: project } = await supabase.schema("portal")
    .from("projects").select("id, title, cu_list_id, client_slug").eq("id", project_id).maybeSingle();
  if (!project) return "";
  if (expectedClientSlug !== undefined && project.client_slug !== expectedClientSlug) {
    console.error("ensureProjectList: projeto de outro cliente — usando a lista do cliente", project_id, project.client_slug, expectedClientSlug);
    return "";
  }
  let listId = String(project.cu_list_id || "").trim();
  if (!listId) {
    listId = await createListUnique(apiKey, folderId, (project.title || "Projeto").trim());
    await supabase.schema("portal").from("projects").update({ cu_list_id: listId }).eq("id", project_id);
  }
  return listId;
}

// Garante a lista "Avulsas" do aluno (clients.cu_inbox_list_id) p/ demandas sem projeto.
async function ensureInboxList(supabase: any, apiKey: string, folderId: string, client: any): Promise<string> {
  let listId = String(client.cu_inbox_list_id || "").trim();
  if (!listId) {
    listId = await createList(apiKey, folderId, "Avulsas");
    await supabase.schema("portal").from("clients").update({ cu_inbox_list_id: listId }).eq("slug", client.slug);
    client.cu_inbox_list_id = listId;
  }
  return listId;
}

// Lista de destino da demanda na hierarquia nova. Fallback p/ lista legada/global.
async function resolveDestinationList(supabase: any, apiKey: string, cfg: any, demand: any): Promise<string> {
  const ensured = await ensureClientFolder(supabase, apiKey, cfg, demand.client_slug);
  if (!ensured) return await legacyClientList(supabase, demand.client_slug, cfg);
  const { folderId, client } = ensured;
  if (demand.project_id) {
    const lid = await ensureProjectList(supabase, apiKey, folderId, demand.project_id, demand.client_slug);
    if (lid) return lid;
  }
  return await ensureInboxList(supabase, apiKey, folderId, client);
}

// Fallback legado: lista folderless do cliente (clients.cu_list_id) ou lista global.
async function legacyClientList(supabase: any, client_slug: string, cfg: any): Promise<string> {
  if (!client_slug) return cfg.list_id;
  const { data } = await supabase.schema("portal")
    .from("clients").select("cu_list_id").eq("slug", client_slug).maybeSingle();
  return String(data?.cu_list_id || "").trim() || cfg.list_id;
}

// Provisiona a estrutura (pastas + listas) para TODOS os clientes/projetos. Não move
// tarefas existentes (a API do ClickUp não move entre listas). Idempotente.
async function provisionStructure(supabase: any, apiKey: string, cfg: any): Promise<Response> {
  const out = { folders: 0, inbox_lists: 0, project_lists: 0, clients: 0, errors: [] as string[] };
  const { data: clients } = await supabase.schema("portal").from("clients").select("slug");
  for (const c of (clients || [])) {
    out.clients++;
    try {
      const ensured = await ensureClientFolder(supabase, apiKey, cfg, c.slug);
      if (!ensured) continue;
      out.folders++;
      await ensureInboxList(supabase, apiKey, ensured.folderId, ensured.client);
      out.inbox_lists++;
      const { data: projects } = await supabase.schema("portal")
        .from("projects").select("id, cu_list_id").eq("client_slug", c.slug);
      for (const p of (projects || [])) {
        if (String(p.cu_list_id || "").trim()) continue;
        try {
          await ensureProjectList(supabase, apiKey, ensured.folderId, p.id);
          out.project_lists++;
        } catch (e) {
          out.errors.push(`projeto ${p.id}: ${String((e as any)?.message || e)}`);
        }
        await new Promise((r) => setTimeout(r, 350)); // throttle ClickUp
      }
      await new Promise((r) => setTimeout(r, 350));
    } catch (e) {
      out.errors.push(`${c.slug}: ${String((e as any)?.message || e)}`);
    }
  }
  return new Response(JSON.stringify({ ok: true, ...out }), { status: 200, headers: { "Content-Type": "application/json" } });
}

// 095: "o prazo do ClickUp difere do gravado?" — mesma regra de
// portal.apply_clickup_due_change, no fuso America/Sao_Paulo:
//   - sem hora (due_has_time !== true, ou a task diz due_date_time === false) →
//     compara só a DATA em SP;
//   - com hora → compara até o MINUTO em SP.
// GET /task não traz due_date_time; quando vier (payload), false força "só data".
// due_at nulo = nunca semeado → difere (a RPC semeia sem aviso).
const SP_MINUTE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function spParts(ms: number): { date: string; minute: string } {
  const p = Object.fromEntries(SP_MINUTE_FMT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, minute: `${date}T${p.hour}:${p.minute}` };
}
function dueDiffersSP(
  dueAtIso: string | null | undefined, dueHasTime: boolean | null | undefined,
  taskDueDateTime: boolean | null | undefined, clickupDueMs: number,
): boolean {
  if (!Number.isFinite(clickupDueMs)) return false;
  if (!dueAtIso) return true;
  const storedMs = Date.parse(dueAtIso);
  if (!Number.isFinite(storedMs)) return true;
  const withTime = dueHasTime === true && taskDueDateTime !== false;
  const a = spParts(storedMs), b = spParts(clickupDueMs);
  return withTime ? a.minute !== b.minute : a.date !== b.date;
}

const RECONCILE_DEFAULT_LIMIT = 25;
const RECONCILE_MAX_LIMIT = 100;

// Varre demandas com clickup_task_id e compara operadores esperados (portal)
// vs assignees reais (ClickUp), populando clickup_assignee_sync/detail com a MESMA
// classificação por guest usada em createTask/updateTask (buildAssigneeSyncState).
// Ação MANUAL (não roda em cron) — passivo das divergências não é reaplicado em
// massa, só fica visível no painel para resolução caso a caso (decisão do Marcio).
//
// v14 (086/087): pagina por created_at (cursor `after` = ISO timestamp da última
// demanda processada no lote anterior). SEM ISSO: 1.500 demandas × 350ms de throttle
// ≈ 8,75 min só de espera (mais o tempo de rede de cada GET /task) — passa dos 150s
// de timeout da Edge Function, e sem cursor o corte no meio do caminho perde TODO o
// progresso do lote (próxima chamada recomeça do zero). Com cursor, cada chamada
// processa até `limit` demandas e devolve `next_cursor` para o chamador continuar.
type ReconcileBatchResult = {
  checked: number; ok: number; partial: number; partial_expected: number; none: number;
  skipped_external: number; due_changes: number; errors: string[]; next_cursor: string | null;
};

async function reconcileAssigneesBatch(
  supabase: any, apiKey: string, cfg: any, limit: number, after: string | null,
): Promise<ReconcileBatchResult | { error: string }> {
  const out = {
    checked: 0, ok: 0, partial: 0, partial_expected: 0, none: 0,
    skipped_external: 0, due_changes: 0,
    errors: [] as string[], next_cursor: null as string | null,
  };

  // v15: lê clickup_assignee_sync junto — é o que permite PULAR as demandas em
  // 'external_*' logo abaixo.
  let q = supabase.schema("portal")
    .from("demands").select("id, clickup_task_id, created_at, clickup_assignee_sync, due_at, due_has_time")
    .not("clickup_task_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (after) q = q.gt("created_at", after);
  const { data: demands, error } = await q;
  if (error) return { error: "demands: " + error.message };

  const multiAllowed = await spaceAllowsMultipleAssignees(supabase, apiKey, cfg);
  const { guestIds, memberIds } = await getTeamRoles(supabase, apiKey, cfg);

  for (const d of (demands || [])) {
    out.checked++;
    // ⚠️ PULA demandas já classificadas como 'external_*' (conflito 4 do plano: o P5
    // anularia o P2). O split external_loss/reassigned/added é conhecimento do WEBHOOK
    // — ele viu QUEM saiu e QUEM entrou no momento do evento. Este reconcile só compara
    // portal × ClickUp e produz ok/partial/partial_expected/none; passar por uma demanda
    // 'external_reassigned' a reclassificaria como 'partial' (ou 'none'), apagando a
    // distinção que o passo 2 criou — todo dia às 04:00, em silêncio, e ainda tirando-a
    // da fila ou botando-a de volta errada. O estado external só sai daqui por ação do
    // admin (admin_resolve_assignee_divergence), por auto-reconciliação, ou por um novo
    // evento do webhook que faça convergir.
    const prevSync: string = d.clickup_assignee_sync || "";
    if (prevSync.startsWith("external")) {
      out.skipped_external++;
      out.next_cursor = d.created_at;
      continue; // sem throttle: não houve chamada ao ClickUp
    }
    try {
      const dops = await getDemandOperatorIds(supabase, d.id);
      const expected = await expectedOpsFor(supabase, dops);
      const task = await fetchTask(apiKey, d.clickup_task_id);
      const actual = actualAssigneesFromResponse(task);
      const { sync, detail, perOperator } = buildAssigneeSyncState(expected, actual, guestIds, memberIds, multiAllowed);

      await persistAssigneeSync(supabase, cfg, d.id, sync, detail, perOperator);
      // 095: prazo — reaproveita o MESMO task (sem GET extra). Só chama a RPC quando o
      // prazo do ClickUp difere de due_at PELA MESMA REGRA DA RPC (fuso de SP): sem hora
      // → compara só a data; com hora → compara até o minuto. Comparar em ms dava
      // "diferente" todo dia nas demandas sem hora (o ClickUp normaliza data sem hora
      // para outro horário) = 1 FOR UPDATE + 1 no_change por demanda legada, por dia.
      // Isolado em try próprio: falha no prazo não pode apagar a contagem de assignees.
      try {
        const dueMs = task?.due_date ? Number(task.due_date) : NaN;
        if (Number.isFinite(dueMs) && dueDiffersSP(d.due_at, d.due_has_time, task?.due_date_time, dueMs)) {
          const { data: dueRes, error: dueErr } = await supabase.schema("portal").rpc("apply_clickup_due_change", {
            p_demand_id: d.id, p_due_at: new Date(dueMs).toISOString(), p_has_time: null, p_source: "sweep",
          });
          if (dueErr) out.errors.push(`${d.id}: due ${dueErr.message}`);
          else if ((dueRes as any)?.result && (dueRes as any).result !== "no_change") out.due_changes++;
        }
      } catch (e) {
        out.errors.push(`${d.id}: due ${String((e as any)?.message || e)}`);
      }
      if (sync === "ok") out.ok++;
      else if (sync === "partial") out.partial++;
      else if (sync === "partial_expected") out.partial_expected++;
      else if (sync === "none") out.none++;
      out.next_cursor = d.created_at;
    } catch (e) {
      out.errors.push(`${d.id}: ${String((e as any)?.message || e)}`);
    }
    await new Promise((r) => setTimeout(r, 350)); // throttle ClickUp
  }
  // Só sinaliza "tem mais" se o lote veio cheio (senão next_cursor aponta pro fim,
  // o chamador saberia parar de qualquer forma, mas fica explícito).
  if ((demands || []).length < limit) out.next_cursor = null;
  return out;
}

// Teto de lotes de UMA invocação com {all:true}. 4 × 25 = 100 demandas por execução
// do cron. O teto é de TEMPO, não de vontade: cada demanda custa ~350 ms de throttle
// + o GET /task, e a Edge Function morre em 150 s. 100 × ~0,5 s ≈ 50 s deixa folga
// confortável; 8 lotes já flertariam com o timeout e o trabalho do lote cortado no
// meio não é perdido (o cursor avança), mas o `stopped_reason` deixaria de ser
// informativo. Passivo maior que 100/dia significa que algo está errado a montante —
// é para aparecer, não para ser absorvido em silêncio.
const RECONCILE_MAX_BATCHES = 4;

// Entrada da ação `reconcile_assignees`. Dois modos:
//   {limit, after}  → UM lote, devolve next_cursor (modo manual, já existia na v14).
//   {all:true}      → encadeia lotes internamente até next_cursor=null ou o teto de
//                      RECONCILE_MAX_BATCHES. É o modo do CRON (migration 090):
//                      pg_cron dispara UMA chamada HTTP e vai embora — não existe quem
//                      leia o next_cursor e chame de novo. Sem isto, o cron diário
//                      reconciliaria eternamente só as 25 demandas mais antigas.
async function reconcileAssignees(supabase: any, apiKey: string, cfg: any, body: any): Promise<Response> {
  const limit = Math.min(RECONCILE_MAX_LIMIT, Math.max(1, Number(body?.limit) || RECONCILE_DEFAULT_LIMIT));
  const all = body?.all === true;
  let cursor = typeof body?.after === "string" ? body.after : null;

  const total: ReconcileBatchResult & { batches: number; stopped_reason: string } = {
    checked: 0, ok: 0, partial: 0, partial_expected: 0, none: 0, skipped_external: 0,
    due_changes: 0, errors: [], next_cursor: null, batches: 0, stopped_reason: "",
  };

  const maxBatches = all ? RECONCILE_MAX_BATCHES : 1;
  for (let i = 0; i < maxBatches; i++) {
    const res = await reconcileAssigneesBatch(supabase, apiKey, cfg, limit, cursor);
    if ("error" in res) {
      // Erro no meio do encadeamento: devolve o PROGRESSO já feito (os lotes
      // anteriores gravaram de verdade) junto do erro — o cursor perdido é o custo,
      // mas o cron da noite seguinte recomeça do início e reencontra o mesmo ponto.
      return new Response(
        JSON.stringify({ ...total, ok_count: total.ok, ok: false, error: res.error }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    total.batches++;
    total.checked += res.checked;
    total.ok += res.ok;
    total.partial += res.partial;
    total.partial_expected += res.partial_expected;
    total.none += res.none;
    total.skipped_external += res.skipped_external;
    total.due_changes += res.due_changes;
    total.errors.push(...res.errors);
    total.next_cursor = res.next_cursor;
    cursor = res.next_cursor;
    if (!cursor) { total.stopped_reason = "completed"; break; }
    if (i === maxBatches - 1) total.stopped_reason = all ? "batch_cap" : "single_batch";
  }

  // ⚠️ `total.ok` é o CONTADOR de demandas convergidas, e colide com o `ok: true` do
  // envelope de resposta. Espalhar depois (`{ok:true, ...total}`) fazia o contador
  // sobrescrever o booleano — o chamador passaria a ler `ok: 7`. Ordem invertida de
  // propósito: o envelope vence, e o contador continua legível em `ok_count`.
  return new Response(
    JSON.stringify({ ...total, ok_count: total.ok, ok: true }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function getDemandOperatorIds(supabase: any, demand_id: string): Promise<string[]> {
  const { data: dops } = await supabase.schema("portal")
    .from("demand_operators").select("operator_id").eq("demand_id", demand_id);
  return (dops || []).map((d: any) => d.operator_id);
}

// Monta a lista de operadores esperados no formato que buildAssigneeSyncState precisa.
// v14: recebe os operator_ids já e busca os operadores direto (antes recebia `members`
// no formato de getMembersInfo e filtrava quem não tinha clickup_user_id ANTES de
// chegar aqui — a razão 'no_clickup_user' nunca existia de fato). Agora inclui todos
// os operadores da demanda, com clickup_user_id null quando ausente.
async function expectedOpsFor(supabase: any, operatorIds: string[]): Promise<Array<{ operator_id: string; clickup_user_id: number | null; name: string | null }>> {
  if (!operatorIds.length) return [];
  const { data: ops } = await supabase.schema("portal")
    .from("operators").select("id, name, email, clickup_user_id").in("id", operatorIds);
  return (ops || []).map((o: any) => {
    const cid = o.clickup_user_id ? Number(o.clickup_user_id) : NaN;
    return {
      operator_id: o.id,
      clickup_user_id: !isNaN(cid) ? cid : null,
      name: o.name || o.email || null,
    };
  });
}

// Variante usada por createTask/updateTask, que já tem `members` no formato antigo
// (getMembersInfo) — evita 2ª query redundante quando o operator_id já é conhecido.
function expectedOpsFromMembers(members: any[]): Array<{ operator_id: string; clickup_user_id: number | null; name: string | null }> {
  return members
    .filter((m) => m.role === "operator")
    .map((m) => {
      const cid = m.user.clickup_user_id ? Number(m.user.clickup_user_id) : NaN;
      return {
        operator_id: m.user_id,
        clickup_user_id: !isNaN(cid) ? cid : null,
        name: m.user.name || m.user.email || null,
      };
    });
}

// Extrai os assignees REAIS da resposta do ClickUp (POST/PUT/GET devolvem a task
// atualizada) — é essa lista, não o que foi pedido, que decide o estado.
function actualAssigneesFromResponse(task: any): Array<{ id: number; name: string }> {
  return ((task?.assignees || []) as any[])
    .map((a: any) => ({ id: Number(a.id), name: a.username || a.email || String(a.id) }))
    .filter((a) => !isNaN(a.id));
}

// Depois de criar/atualizar, compara o esperado com o que voltou de fato na resposta
// e grava o estado. Caminho PRINCIPAL de detecção (a mistura member+guest é aceita
// com HTTP 200 e o ClickUp descarta o guest em silêncio — não há exceção pra pegar).
async function reconcileFromResponse(
  supabase: any, apiKey: string, cfg: any, demand_id: string, members: any[], task: any,
) {
  const multiAllowed = await spaceAllowsMultipleAssignees(supabase, apiKey, cfg);
  const { guestIds, memberIds } = await getTeamRoles(supabase, apiKey, cfg);
  const expected = expectedOpsFromMembers(members);
  const actual = actualAssigneesFromResponse(task);
  const { sync, detail, perOperator } = buildAssigneeSyncState(expected, actual, guestIds, memberIds, multiAllowed);
  await persistAssigneeSync(supabase, cfg, demand_id, sync, detail, perOperator);
}

async function createTask(supabase: any, apiKey: string, listId: string, cfg: any, demand: any, members: any[], requester: string) {
  const legacy = cfg.assignee_strategy === "legacy";
  const assignees = assigneesFor(members);
  const markdown = await buildCreateMarkdown(supabase, demand);

  let task;
  try {
    task = await clickupRequest(apiKey, `/list/${listId}/task`, {
      method: "POST",
      body: JSON.stringify(buildCreatePayload(demand, assignees, markdown)),
    });
  } catch (e) {
    const msg = String((e as any)?.message || e);
    // ITEM_417 (espaço sem múltiplos assignees — hoje ligado, mas mantido como rede
    // caso seja desligado de novo) e ITEM_087 (sem acesso à pasta) são ramos
    // SEPARADOS — causas diferentes, log e reconciliação diferentes. A mistura
    // member+guest NÃO cai aqui — o ClickUp aceita com 200 e descarta o guest
    // em silêncio (por isso reconcileFromResponse() roda sempre depois, e não só
    // nestes catches).
    if (assignees.length > 1 && msg.includes("ITEM_417")) {
      console.warn("ITEM_417 — espaço single-assignee, recriando com 1 responsável");
      task = await clickupRequest(apiKey, `/list/${listId}/task`, {
        method: "POST",
        body: JSON.stringify(buildCreatePayload(demand, assignees.slice(0, 1), markdown)),
      });
    } else if (assignees.length && msg.includes("ITEM_087")) {
      // Responsáveis sem acesso à pasta (ITEM_087, pasta recém-criada/privada):
      // cria a task SEM responsáveis. Melhor uma task sem assignee do que nenhuma —
      // o vínculo se resolve quando a pasta for compartilhada (próxima atualização
      // reconcilia os assignees).
      console.warn("ITEM_087 — responsáveis sem acesso à pasta, criando sem responsáveis");
      task = await clickupRequest(apiKey, `/list/${listId}/task`, {
        method: "POST",
        body: JSON.stringify(buildCreatePayload(demand, [], markdown)),
      });
    } else {
      throw e;
    }
  }
  await setCustomFields(apiKey, task.id, cfg, demand, members, requester);
  if (!legacy) await reconcileFromResponse(supabase, apiKey, cfg, demand.id, members, task);
  return task;
}

async function updateTask(supabase: any, apiKey: string, cfg: any, task_id: string, demand: any, members: any[], requester: string) {
  const legacy = cfg.assignee_strategy === "legacy";
  const desired = new Set(assigneesFor(members));
  const currentTask = await fetchTask(apiKey, task_id);
  const current = new Set(assigneeIdsFromTask(currentTask));
  const add = [...desired].filter((id) => !current.has(id));
  const rem = [...current].filter((id) => !desired.has(id));

  let task;
  try {
    task = await clickupRequest(apiKey, `/task/${task_id}`, {
      method: "PUT",
      body: JSON.stringify(buildUpdatePayload(demand, add, rem)),
    });
  } catch (e) {
    const msg = String((e as any)?.message || e);
    // Ramos separados ITEM_417/ITEM_087 — mesma razão do createTask. A mistura
    // member+guest não cai aqui (200 silencioso); reconcileFromResponse() cobre isso.
    if (add.length > 1 && msg.includes("ITEM_417")) {
      console.warn("ITEM_417 — espaço single-assignee, atualizando com 1 responsável");
      task = await clickupRequest(apiKey, `/task/${task_id}`, {
        method: "PUT",
        body: JSON.stringify(buildUpdatePayload(demand, add.slice(0, 1), rem)),
      });
    } else if (msg.includes("ITEM_087")) {
      // Responsáveis sem acesso à pasta (ITEM_087): atualiza status/título/datas SEM
      // mexer nos assignees, pra não travar a propagação do resto da demanda.
      console.warn("ITEM_087 — assignees barrados, atualizando sem mexer neles");
      task = await clickupRequest(apiKey, `/task/${task_id}`, {
        method: "PUT",
        body: JSON.stringify(buildUpdatePayload(demand, [], [])),
      });
    } else {
      throw e;
    }
  }
  await setCustomFields(apiKey, task_id, cfg, demand, members, requester);
  if (!legacy) await reconcileFromResponse(supabase, apiKey, cfg, demand.id, members, task);
  return task;
}

Deno.serve(async (req: Request) => {
  let body: any = {}; try { body = await req.json(); } catch (_) { body = {}; }
  const { demand_id, event } = body;
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const provided = req.headers.get("x-internal-key") || "";
    const auth     = req.headers.get("Authorization") || "";
    const bearer   = auth.replace(/^Bearer /i, "").trim();
    const internalKey = await getSecret(supabase, "clickup_sync_internal_key");
    const okInternal = internalKey && provided === internalKey;
    // Comparação EXATA do Bearer (não substring) para evitar bypass por prefixo.
    const okService  = SERVICE_KEY.length > 20 && bearer === SERVICE_KEY;
    if (!okInternal && !okService) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const apiKey = await getSecret(supabase, "clickup_api_key");
    if (!apiKey) return new Response(JSON.stringify({ error: "clickup_api_key ausente" }), { status: 500, headers: { "Content-Type": "application/json" } });

    const cfg = await getConfig(supabase);

    // Modo lote: cria a estrutura (pastas + listas) para todos os clientes/projetos.
    if (body.action === "provision_structure") {
      return await provisionStructure(supabase, apiKey, cfg);
    }

    // Modo lote: varre demandas com clickup_task_id e popula clickup_assignee_sync/
    // detail comparando com o estado real no ClickUp (mesma classificação por guest de
    // createTask/updateTask). Só LÊ o ClickUp — não escreve assignees (isso é papel do
    // create/updateTask). Paginado (v14): {limit, after} continua de onde parou.
    // v15: {all:true} encadeia os lotes internamente — é como o cron diário
    // 'reconcile-assignees' (migration 090, 04:00 UTC) chama. Demandas em 'external_*'
    // são PULADAS (skipped_external) para não desfazer o split do webhook.
    if (body.action === "reconcile_assignees") {
      return await reconcileAssignees(supabase, apiKey, cfg, body);
    }

    // Garante a pasta do aluno + a lista do projeto e devolve o list_id (usado pelo
    // /api/briefing-to-clickup para anexar o PDF do briefing na lista do projeto).
    if (body.action === "ensure_project_list") {
      const pid = body.project_id;
      if (!pid) return new Response(JSON.stringify({ error: "project_id obrigatório" }), { status: 400, headers: { "Content-Type": "application/json" } });
      const { data: project } = await supabase.schema("portal").from("projects").select("id, client_slug").eq("id", pid).maybeSingle();
      if (!project) return new Response(JSON.stringify({ error: "projeto não encontrado" }), { status: 404, headers: { "Content-Type": "application/json" } });
      const ensured = await ensureClientFolder(supabase, apiKey, cfg, project.client_slug);
      if (!ensured) return new Response(JSON.stringify({ error: "cliente sem pasta possível (sem slug/space_id)" }), { status: 422, headers: { "Content-Type": "application/json" } });
      const listId = await ensureProjectList(supabase, apiKey, ensured.folderId, pid);
      return new Response(JSON.stringify({ ok: true, list_id: listId, folder_id: ensured.folderId }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (!demand_id) {
      return new Response(JSON.stringify({ error: "demand_id obrigatório" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const demand = await getDemand(supabase, demand_id);
    if (!demand) return new Response(JSON.stringify({ error: "demand não encontrada" }), { status: 404, headers: { "Content-Type": "application/json" } });

    const [members, requester] = await Promise.all([
      getMembersInfo(supabase, demand_id),
      getRequesterEmail(supabase, demand.created_by),
    ]);

    let task;
    if (demand.clickup_task_id) {
      task = await updateTask(supabase, apiKey, cfg, demand.clickup_task_id, demand, members, requester);
    } else {
      const listId = await resolveDestinationList(supabase, apiKey, cfg, demand);
      task = await createTask(supabase, apiKey, listId, cfg, demand, members, requester);
      // Persistir o vínculo é crítico: se falhar, a próxima execução cria task
      // duplicada. Propaga o erro para o trigger pg_net poder reprocessar.
      const { error: linkErr } = await supabase.schema("portal").from("demands")
        .update({ clickup_task_id: task.id }).eq("id", demand_id);
      if (linkErr) throw new Error("persist clickup_task_id: " + linkErr.message);
    }

    return new Response(JSON.stringify({
      ok: true, event, task_id: task.id,
      assignees: assigneesFor(members),
      status_mapped: mapStatus(demand.status),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
