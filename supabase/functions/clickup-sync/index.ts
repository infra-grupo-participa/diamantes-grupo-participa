// clickup-sync v14 — hierarquia Pasta(aluno) → Lista(projeto/avulsas) → Tarefa(demanda).
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
// ⚠️ Fonte da verdade vive no Supabase (deploy via `supabase functions deploy`).
// Este arquivo é a cópia versionada — mantenha em sincronia ao editar a função.
//
// ⚠️ EDIÇÃO 2026-09-03 (086/087, v14): feita SOBRE A CÓPIA DO REPO, sem confirmação
// contra o remoto (supabase functions download indisponível neste ambiente — sem
// SUPABASE_ACCESS_TOKEN). NÃO FAÇA DEPLOY sem antes diffar este arquivo contra
// `supabase functions download clickup-sync` a partir de uma máquina autenticada —
// ver supabase/functions/README.md, seção "Primeiro deploy".
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
    const isDivergentNow = sync !== "ok" && sync !== "external"; // 'external' é alertado pelo webhook, não aqui

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

function buildCreatePayload(demand: any, assignees: number[]) {
  const p: any = {
    name: taskName(demand),
    description: demand.description || "",
    status: mapStatus(demand.status),
    assignees,
  };
  if (demand.starts_at) p.start_date = new Date(demand.starts_at + "T12:00:00Z").getTime();
  if (demand.ends_at)   p.due_date   = new Date(demand.ends_at   + "T12:00:00Z").getTime();
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
    description: demand.description || "",
    status: mapStatus(demand.status),
  };
  if (demand.starts_at) p.start_date = new Date(demand.starts_at + "T12:00:00Z").getTime();
  if (demand.ends_at)   p.due_date   = new Date(demand.ends_at   + "T12:00:00Z").getTime();
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
async function ensureProjectList(supabase: any, apiKey: string, folderId: string, project_id: string): Promise<string> {
  const { data: project } = await supabase.schema("portal")
    .from("projects").select("id, title, cu_list_id").eq("id", project_id).maybeSingle();
  if (!project) return "";
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
    const lid = await ensureProjectList(supabase, apiKey, folderId, demand.project_id);
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
async function reconcileAssignees(supabase: any, apiKey: string, cfg: any, body: any): Promise<Response> {
  const limit = Math.min(RECONCILE_MAX_LIMIT, Math.max(1, Number(body?.limit) || RECONCILE_DEFAULT_LIMIT));
  const after = typeof body?.after === "string" ? body.after : null;

  const out = { checked: 0, ok: 0, partial: 0, partial_expected: 0, none: 0, errors: [] as string[], next_cursor: null as string | null };

  let q = supabase.schema("portal")
    .from("demands").select("id, clickup_task_id, created_at")
    .not("clickup_task_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (after) q = q.gt("created_at", after);
  const { data: demands, error } = await q;
  if (error) return new Response(JSON.stringify({ error: "demands: " + error.message }), { status: 500, headers: { "Content-Type": "application/json" } });

  const multiAllowed = await spaceAllowsMultipleAssignees(supabase, apiKey, cfg);
  const { guestIds, memberIds } = await getTeamRoles(supabase, apiKey, cfg);

  for (const d of (demands || [])) {
    out.checked++;
    try {
      const dops = await getDemandOperatorIds(supabase, d.id);
      const expected = await expectedOpsFor(supabase, dops);
      const task = await fetchTask(apiKey, d.clickup_task_id);
      const actual = actualAssigneesFromResponse(task);
      const { sync, detail, perOperator } = buildAssigneeSyncState(expected, actual, guestIds, memberIds, multiAllowed);

      await persistAssigneeSync(supabase, cfg, d.id, sync, detail, perOperator);
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
  return new Response(JSON.stringify({ ok: true, ...out }), { status: 200, headers: { "Content-Type": "application/json" } });
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

  let task;
  try {
    task = await clickupRequest(apiKey, `/list/${listId}/task`, {
      method: "POST",
      body: JSON.stringify(buildCreatePayload(demand, assignees)),
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
        body: JSON.stringify(buildCreatePayload(demand, assignees.slice(0, 1))),
      });
    } else if (assignees.length && msg.includes("ITEM_087")) {
      // Responsáveis sem acesso à pasta (ITEM_087, pasta recém-criada/privada):
      // cria a task SEM responsáveis. Melhor uma task sem assignee do que nenhuma —
      // o vínculo se resolve quando a pasta for compartilhada (próxima atualização
      // reconcilia os assignees).
      console.warn("ITEM_087 — responsáveis sem acesso à pasta, criando sem responsáveis");
      task = await clickupRequest(apiKey, `/list/${listId}/task`, {
        method: "POST",
        body: JSON.stringify(buildCreatePayload(demand, [])),
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

    // Modo lote (manual, não-cron): varre demandas com clickup_task_id e popula
    // clickup_assignee_sync/detail comparando com o estado real no ClickUp (mesma
    // classificação por guest de createTask/updateTask). Só LÊ o ClickUp — não
    // escreve assignees (isso é papel do create/updateTask). Paginado (v14): passe
    // {limit, after} para continuar de onde parou (next_cursor da resposta anterior).
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
