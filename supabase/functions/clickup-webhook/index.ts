// clickup-webhook v3 — sync reversa: task updates + comentários + assignees.
// ClickUp → (webhook) → esta função → portal.demands / portal.demand_messages.
//
// v3 (migration 086): ramo taskAssigneeUpdated ANTES do bloco genérico de task field
// updates. Compara demand_operators (via operators.clickup_user_id) com task.assignees
// e grava clickup_assignee_sync='external' + detail antes/depois quando diverge (e volta
// para 'ok' quando converge). NÃO escreve em demand_operators — o webhook só OBSERVA e
// REGISTRA; o admin decide pelo painel via portal.admin_resolve_assignee_divergence
// (decisão do Marcio). Também dispara e-mail ao admin (send-email type
// 'divergencia_assignee', context:'webhook') quando a divergência é NOVA (não reenvia se
// já estava 'external' e continua 'external' com o mesmo conjunto de assignees).
//
// 'external' é DIFERENTE de 'partial'/'partial_expected'/'none' (populados pelo
// clickup-sync na saída portal→ClickUp, ver esse arquivo para o caso GUEST): aqui é
// sempre uma mudança feita DIRETO no ClickUp, fora do fluxo do portal.
//
// ⚠️ Este evento só chega se o webhook estiver REGISTRADO com taskAssigneeUpdated na
// lista de eventos (webhook_id em portal.clickup_config). Escutar no código não faz o
// ClickUp enviar — é preciso re-registrar via API e confirmar.
//
// ⚠️ Fonte da verdade vive no Supabase (deploy via `supabase functions deploy`).
// Este arquivo é a cópia versionada — mantenha em sincronia ao editar a função.
//
// ⚠️ EDIÇÃO 2026-09-01 (086/B3): feita SOBRE A CÓPIA DO REPO, sem confirmação contra o
// remoto (supabase functions download indisponível neste ambiente — sem
// SUPABASE_ACCESS_TOKEN). NÃO FAÇA DEPLOY sem antes diffar este arquivo contra
// `supabase functions download clickup-webhook` a partir de uma máquina autenticada.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CLICKUP_API  = "https://api.clickup.com/api/v2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function mapStatusReverse(s: string): string | null {
  const lower = (s || "").toLowerCase();
  switch (lower) {
    case "aberta":         return "open";
    case "em andamento":   return "in_progress";
    case "em revisão":
    case "em revisao":     return "review";
    case "concluída":
    case "concluida":      return "done";
    case "cancelado":
    case "cancelada":      return "canceled";
  }
  return null;
}

async function getSecret(supabase: any, name: string): Promise<string> {
  const { data, error } = await supabase.schema("portal")
    .rpc("get_internal_secret", { p_name: name });
  if (error) throw new Error(`secret ${name}: ${error.message}`);
  return data || "";
}

async function verifyHmac(payload: string, signature: string, secret: string): Promise<boolean> {
  if (!secret || !signature) return false;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (hex.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  } catch (e) { console.error("verifyHmac err", e); return false; }
}

async function fetchTaskFromClickUp(apiKey: string, taskId: string): Promise<any> {
  const r = await fetch(`${CLICKUP_API}/task/${taskId}`, { headers: { "Authorization": apiKey } });
  if (!r.ok) throw new Error(`ClickUp GET task ${r.status}`);
  return r.json();
}

async function fetchCommentsFromClickUp(apiKey: string, taskId: string): Promise<any[]> {
  const r = await fetch(`${CLICKUP_API}/task/${taskId}/comment?start=0`, { headers: { "Authorization": apiKey } });
  if (!r.ok) throw new Error(`ClickUp GET comments ${r.status}`);
  const j = await r.json();
  return j.comments || [];
}

async function findUserForClickUpUser(supabase: any, cuUser: any): Promise<{ id: string; name: string; role: string } | null> {
  if (!cuUser) return null;
  const id = cuUser.id ? Number(cuUser.id) : null;
  if (id) {
    const { data } = await supabase.schema("portal").from("users")
      .select("id, name, role").eq("clickup_user_id", id).maybeSingle();
    if (data) return data;
  }
  if (cuUser.email) {
    const { data } = await supabase.schema("portal").from("users")
      .select("id, name, role").eq("email", cuUser.email.toLowerCase()).maybeSingle();
    if (data) return data;
  }
  return null;
}

// Dispara o alerta de divergência ao admin reusando a trilha existente
// (email_log + edge send-email) — sem canal novo. Best-effort: falha SÓ loga,
// nunca derruba o processamento do webhook (mesma lição do try/catch-log das
// migrations 032/054/055).
async function notifyAdminDivergence(supabase: any, demand_id: string, before: string[], after: string[]) {
  try {
    const key = await getSecret(supabase, "clickup_sync_internal_key");
    if (!key) return;
    // context:'webhook' → send-email usa o rótulo "portal esperava/ClickUp tem"
    // (mudança feita direto no ClickUp, fora do portal — estado 'external').
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": key },
      body: JSON.stringify({ type: "divergencia_assignee", demand_id, context: "webhook", before, after }),
    });
  } catch (e) {
    console.error("notifyAdminDivergence err", demand_id, (e as any)?.message || e);
  }
}

// ===== taskAssigneeUpdated =====
// Compara demand_operators (esperado, via operators.clickup_user_id) com os
// assignees reais da task (ClickUp). NUNCA escreve em demand_operators — só
// observa e registra (decisão do Marcio: o admin decide manualmente pelo
// painel, via portal.admin_resolve_assignee_divergence).
async function handleAssigneeUpdated(supabase: any, apiKey: string, demand: any) {
  const { data: dops } = await supabase.schema("portal")
    .from("demand_operators").select("operator_id").eq("demand_id", demand.id);
  const opIds = (dops || []).map((d: any) => d.operator_id);
  let expectedOps: Array<{ clickup_user_id: number | null; name: string | null }> = [];
  if (opIds.length) {
    const { data: ops } = await supabase.schema("portal")
      .from("operators").select("clickup_user_id, name").in("id", opIds);
    expectedOps = ops || [];
  }
  const expected = new Set(
    expectedOps.map((o) => (o.clickup_user_id ? Number(o.clickup_user_id) : null)).filter((n): n is number => n !== null && !isNaN(n)),
  );

  const task = await fetchTaskFromClickUp(apiKey, demand.clickup_task_id);
  const currentAssignees: Array<{ id: number; name: string }> = (task?.assignees || [])
    .map((a: any) => ({ id: Number(a.id), name: a.username || a.email || String(a.id) }))
    .filter((a: any) => !isNaN(a.id));
  const current = new Set(currentAssignees.map((a) => a.id));

  const missing = [...expected].filter((id) => !current.has(id));
  const extra = [...current].filter((id) => !expected.has(id));
  const diverged = missing.length > 0 || extra.length > 0;

  const { data: prevDemand } = await supabase.schema("portal")
    .from("demands").select("clickup_assignee_sync").eq("id", demand.id).maybeSingle();
  const wasExternal = prevDemand?.clickup_assignee_sync === "external";

  const beforeNames = expectedOps.map((o) => o.name).filter(Boolean) as string[];
  const afterPayload = currentAssignees.map((a) => ({ id: String(a.id), name: a.name }));
  const afterNames = currentAssignees.map((a) => a.name);

  if (!diverged) {
    await supabase.schema("portal").from("demands")
      .update({ clickup_assignee_sync: "ok", clickup_assignee_detail: {} }).eq("id", demand.id);
    return { converged: true };
  }

  await supabase.schema("portal").from("demands").update({
    clickup_assignee_sync: "external",
    clickup_assignee_detail: { before: beforeNames, after: afterPayload },
  }).eq("id", demand.id);

  await supabase.schema("portal").from("audit_log").insert({
    event: "demand_assignee_divergence_detected",
    user_id: null,
    identifier: demand.id,
    metadata: { before: beforeNames, after: afterNames, missing_count: missing.length, extra_count: extra.length },
  });

  // E-mail só na divergência NOVA (não reenvia a cada evento se já estava external).
  if (!wasExternal) {
    await notifyAdminDivergence(supabase, demand.id, beforeNames, afterNames);
  }
  return { diverged: true, missing: missing.length, extra: extra.length };
}

function stripBotPrefix(text: string): string {
  // Mensagens postadas pelo nosso bot vêm com '**Nome** (papel):\n...'
  // Detectamos e removemos pra evitar duplicidade visual.
  const m = text.match(/^\*\*[^*]+\*\* \((cliente|operador|admin)\):\n([\s\S]*)$/);
  return m ? m[2] : text;
}

async function handleCommentEvent(supabase: any, apiKey: string, payload: any, demand: any, event: string) {
  // payload geralmente traz history_items com o comentário. Mas pra ser robusto,
  // refetcho a lista de comentários e pego o mais recente que ainda não exista.
  const items = (payload?.history_items || []);
  const commentMeta = items.find((h: any) => h.type === 4 || (h.field && h.field.toLowerCase().includes("comment"))) || items[0];
  const userMeta = commentMeta?.user || payload?.user || null;

  const comments = await fetchCommentsFromClickUp(apiKey, demand.clickup_task_id);
  if (comments.length === 0) return { skipped: "no_comments" };

  // Pega comentários que ainda não existem no Supabase
  const cuIds = comments.map((c: any) => String(c.id));
  const { data: existingRows } = await supabase.schema("portal")
    .from("demand_messages")
    .select("clickup_comment_id")
    .in("clickup_comment_id", cuIds);
  const existing = new Set((existingRows || []).map((r: any) => r.clickup_comment_id));

  const toInsert: any[] = [];
  for (const c of comments) {
    const cid = String(c.id);
    if (existing.has(cid)) continue;
    const text = stripBotPrefix(c.comment_text || c.comment || "");
    if (!text.trim()) continue;
    const cuUser = c.user || userMeta || {};
    const author = await findUserForClickUpUser(supabase, cuUser);
    // Autores sem vínculo de operador (pessoas de fora da equipe respondendo na task)
    // entram com user_id null + o nome de exibição vindo do ClickUp (clickup_author).
    toInsert.push({
      demand_id: demand.id,
      user_id: author?.id ?? null,
      clickup_author: author ? null : (cuUser.username || cuUser.email || "Equipe"),
      content: text.trim(),
      origin: "clickup",
      clickup_comment_id: cid,
      created_at: c.date ? new Date(Number(c.date)).toISOString() : new Date().toISOString(),
    });
  }

  if (toInsert.length === 0) return { skipped: "all_already_synced" };

  const { error } = await supabase.schema("portal")
    .from("demand_messages").insert(toInsert);
  // 23505 = unique_violation no índice demand_messages_clickup_comment_id_key:
  // uma corrida (clickup-comment-sync ainda persistindo o cid) já inseriu este
  // comentário. Não é erro — ignora para não gerar 500/retry e sem duplicar.
  if (error && (error as { code?: string }).code === "23505") {
    return { deduped: toInsert.length };
  }
  if (error) throw new Error("insert err: " + error.message);
  return { inserted: toInsert.length };
}

Deno.serve(async (req: Request) => {
  try {
    const rawBody = await req.text();
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const sig = req.headers.get("x-signature") || req.headers.get("X-Signature") || "";
    let webhookSecret = "";
    try { webhookSecret = await getSecret(supabase, "clickup_webhook_secret"); } catch (_) {}
    // Falha FECHADA: sem secret configurado/legível, não há como verificar a
    // origem do payload — recusa em vez de aceitar qualquer requisição.
    if (!webhookSecret) {
      console.error("clickup_webhook_secret ausente — recusando (fail-closed)");
      return new Response(JSON.stringify({ error: "webhook secret not configured" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const valid = await verifyHmac(rawBody, sig, webhookSecret);
    if (!valid) {
      console.warn("HMAC inválido. sig=", sig.slice(0, 16));
      return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    let payload: any = {};
    try { payload = JSON.parse(rawBody); } catch (_) {
      return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const event   = payload.event || "";
    const taskId  = payload.task_id || payload.taskId || "";
    if (!taskId) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_task_id" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const { data: demand } = await supabase.schema("portal")
      .from("demands").select("id, status, title, description, starts_at, ends_at, clickup_task_id, finalized_at")
      .eq("clickup_task_id", taskId).maybeSingle();
    if (!demand) {
      return new Response(JSON.stringify({ ok: true, skipped: "unknown_task", task_id: taskId }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ===== Assignee events (migration 086) — ANTES do bloco genérico de task
    // field updates: só observa/registra, nunca escreve em demand_operators. =====
    if (event === "taskAssigneeUpdated") {
      const apiKey = await getSecret(supabase, "clickup_api_key");
      const res = await handleAssigneeUpdated(supabase, apiKey, demand);
      return new Response(JSON.stringify({ ok: true, event, demand_id: demand.id, ...res }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ===== Comment events =====
    if (event === "taskCommentPosted" || event === "taskCommentUpdated") {
      const apiKey = await getSecret(supabase, "clickup_api_key");
      const res = await handleCommentEvent(supabase, apiKey, payload, demand, event);
      return new Response(JSON.stringify({ ok: true, event, demand_id: demand.id, ...res }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // taskDeleted
    if (event === "taskDeleted") {
      await supabase.schema("portal").from("demands").update({
        status: "canceled",
        last_synced_from_clickup_at: new Date().toISOString(),
      }).eq("id", demand.id);
      return new Response(JSON.stringify({ ok: true, event, demand_id: demand.id, action: "canceled" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // task field updates
    const apiKey = await getSecret(supabase, "clickup_api_key");
    const task = await fetchTaskFromClickUp(apiKey, taskId);

    const patch: any = { last_synced_from_clickup_at: new Date().toISOString() };
    const cuStatusName = task?.status?.status || "";
    const mapped = mapStatusReverse(cuStatusName);
    if (mapped && mapped !== demand.status) patch.status = mapped;
    // Remove o prefixo "[Projeto] " que o clickup-sync adiciona, p/ não poluir o título.
    const cuName = typeof task?.name === "string" ? task.name.replace(/^\s*\[[^\]]*\]\s*/, "").trim() : "";
    if (cuName && cuName !== demand.title) patch.title = cuName;
    if (typeof task?.description === "string" && (task.description || "") !== (demand.description || "")) patch.description = task.description || "";
    if (task?.start_date) {
      const ds = new Date(Number(task.start_date)).toISOString().slice(0, 10);
      if (ds !== (demand.starts_at || "")) patch.starts_at = ds;
    }
    if (task?.due_date) {
      const dd = new Date(Number(task.due_date)).toISOString().slice(0, 10);
      if (dd !== (demand.ends_at || "")) patch.ends_at = dd;
    }
    if (mapped === "done" && !demand.finalized_at) patch.finalized_at = new Date().toISOString();

    const keys = Object.keys(patch).filter(k => k !== "last_synced_from_clickup_at");
    if (keys.length === 0) {
      return new Response(JSON.stringify({ ok: true, event, demand_id: demand.id, action: "no_change" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const { error: upErr } = await supabase.schema("portal")
      .from("demands").update(patch).eq("id", demand.id);
    if (upErr) throw new Error("update err: " + upErr.message);

    return new Response(JSON.stringify({
      ok: true, event, demand_id: demand.id, changed: keys,
      status: patch.status || demand.status,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
