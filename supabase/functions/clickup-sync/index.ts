// clickup-sync v6 — mapping PT-BR + assignees via demand_operators.
// portal.demands (INSERT/UPDATE) → trigger pg_net (portal._sync_demand_to_clickup)
// → esta função cria/atualiza a task no ClickUp e grava demands.clickup_task_id.
//
// ⚠️ Fonte da verdade vive no Supabase (deploy via `supabase functions deploy`).
// Este arquivo é a cópia versionada — mantenha em sincronia ao editar a função.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

function buildCreatePayload(demand: any, assignees: number[]) {
  const p: any = {
    name: demand.title,
    description: demand.description || "",
    status: mapStatus(demand.status),
    assignees,
  };
  if (demand.starts_at) p.start_date = new Date(demand.starts_at + "T12:00:00Z").getTime();
  if (demand.ends_at)   p.due_date   = new Date(demand.ends_at   + "T12:00:00Z").getTime();
  return p;
}

async function fetchCurrentAssignees(apiKey: string, task_id: string): Promise<number[]> {
  try {
    const t = await clickupRequest(apiKey, `/task/${task_id}`);
    return (t?.assignees || []).map((a: any) => Number(a.id)).filter((n: number) => !isNaN(n));
  } catch (_) { return []; }
}

function buildUpdatePayload(demand: any, addAssignees: number[], remAssignees: number[]) {
  const p: any = {
    name: demand.title,
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

async function createTask(apiKey: string, cfg: any, demand: any, members: any[], requester: string) {
  const assignees = assigneesFor(members);
  const task = await clickupRequest(apiKey, `/list/${cfg.list_id}/task`, {
    method: "POST",
    body: JSON.stringify(buildCreatePayload(demand, assignees)),
  });
  await setCustomFields(apiKey, task.id, cfg, demand, members, requester);
  return task;
}

async function updateTask(apiKey: string, cfg: any, task_id: string, demand: any, members: any[], requester: string) {
  const desired  = new Set(assigneesFor(members));
  const current  = new Set(await fetchCurrentAssignees(apiKey, task_id));
  const add = [...desired].filter(id => !current.has(id));
  const rem = [...current].filter(id => !desired.has(id));
  const task = await clickupRequest(apiKey, `/task/${task_id}`, {
    method: "PUT",
    body: JSON.stringify(buildUpdatePayload(demand, add, rem)),
  });
  await setCustomFields(apiKey, task_id, cfg, demand, members, requester);
  return task;
}

Deno.serve(async (req: Request) => {
  let body: any = {}; try { body = await req.json(); } catch (_) { body = {}; }
  const { demand_id, event } = body;
  if (!demand_id) {
    return new Response(JSON.stringify({ error: "demand_id obrigatório" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
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

    const [cfg, demand] = await Promise.all([getConfig(supabase), getDemand(supabase, demand_id)]);
    if (!demand) return new Response(JSON.stringify({ error: "demand não encontrada" }), { status: 404, headers: { "Content-Type": "application/json" } });

    const [members, requester] = await Promise.all([
      getMembersInfo(supabase, demand_id),
      getRequesterEmail(supabase, demand.created_by),
    ]);

    let task;
    if (demand.clickup_task_id) {
      task = await updateTask(apiKey, cfg, demand.clickup_task_id, demand, members, requester);
    } else {
      task = await createTask(apiKey, cfg, demand, members, requester);
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
