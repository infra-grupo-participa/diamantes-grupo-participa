// clickup-sync v10 — hierarquia Pasta(aluno) → Lista(projeto/avulsas) → Tarefa(demanda).
// portal.demands (INSERT/UPDATE) → trigger pg_net (portal._sync_demand_to_clickup)
// → esta função cria/atualiza a task no ClickUp e grava demands.clickup_task_id.
// Também aceita {action:"provision_structure"} para criar pastas/listas em lote.
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

// Nome da task = só o título da demanda. Na hierarquia v10 o PROJETO é a própria
// LISTA (pasta do aluno → lista do projeto), então o prefixo "[Projeto]" é redundante.
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

async function fetchCurrentAssignees(apiKey: string, task_id: string): Promise<number[]> {
  try {
    const t = await clickupRequest(apiKey, `/task/${task_id}`);
    return (t?.assignees || []).map((a: any) => Number(a.id)).filter((n: number) => !isNaN(n));
  } catch (_) { return []; }
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

async function createTask(apiKey: string, listId: string, cfg: any, demand: any, members: any[], requester: string) {
  const assignees = assigneesFor(members);
  let task;
  try {
    task = await clickupRequest(apiKey, `/list/${listId}/task`, {
      method: "POST",
      body: JSON.stringify(buildCreatePayload(demand, assignees)),
    });
  } catch (e) {
    // Espaço sem o ClickApp de múltiplos assignees (ITEM_417): recria com 1 só.
    if (assignees.length > 1 && String((e as any)?.message || e).includes("ITEM_417")) {
      console.warn("espaço single-assignee — recriando com 1 responsável");
      task = await clickupRequest(apiKey, `/list/${listId}/task`, {
        method: "POST",
        body: JSON.stringify(buildCreatePayload(demand, assignees.slice(0, 1))),
      });
    } else {
      throw e;
    }
  }
  await setCustomFields(apiKey, task.id, cfg, demand, members, requester);
  return task;
}

async function updateTask(apiKey: string, cfg: any, task_id: string, demand: any, members: any[], requester: string) {
  const desired  = new Set(assigneesFor(members));
  const current  = new Set(await fetchCurrentAssignees(apiKey, task_id));
  const add = [...desired].filter(id => !current.has(id));
  const rem = [...current].filter(id => !desired.has(id));
  let task;
  try {
    task = await clickupRequest(apiKey, `/task/${task_id}`, {
      method: "PUT",
      body: JSON.stringify(buildUpdatePayload(demand, add, rem)),
    });
  } catch (e) {
    // Espaço single-assignee (ITEM_417): adiciona só 1 responsável.
    if (add.length > 1 && String((e as any)?.message || e).includes("ITEM_417")) {
      task = await clickupRequest(apiKey, `/task/${task_id}`, {
        method: "PUT",
        body: JSON.stringify(buildUpdatePayload(demand, add.slice(0, 1), rem)),
      });
    } else {
      throw e;
    }
  }
  await setCustomFields(apiKey, task_id, cfg, demand, members, requester);
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
      task = await updateTask(apiKey, cfg, demand.clickup_task_id, demand, members, requester);
    } else {
      const listId = await resolveDestinationList(supabase, apiKey, cfg, demand);
      task = await createTask(apiKey, listId, cfg, demand, members, requester);
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
