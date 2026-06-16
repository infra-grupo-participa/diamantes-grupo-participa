// clickup-comment-sync — portal.demand_messages → comentário + ANEXOS no ClickUp.
// Chamada pela trigger pg_net (portal._sync_message_to_clickup) quando uma
// mensagem nova é inserida em portal.demand_messages, e pelo cron de varredura
// (portal._retry_unsynced_message_attachments) como rede de segurança.
//
// E1: além do texto, espelha os anexos do chat como anexos binários da task.
// O retry é DENTRO da Edge (por arquivo); o pg_net é fire-and-forget e não
// reprocessa em erro. Idempotência por arquivo via demand_messages.clickup_attachments.
//
// ⚠️ Fonte da verdade vive no Supabase (deploy via `supabase functions deploy`).
// Este arquivo é a cópia versionada — mantenha em sincronia ao editar a função.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CLICKUP_API  = "https://api.clickup.com/api/v2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BUCKET       = "demand-attachments";

async function getSecret(supabase: any, name: string): Promise<string> {
  const { data, error } = await supabase.schema("portal")
    .rpc("get_internal_secret", { p_name: name });
  if (error) throw new Error(`secret ${name}: ${error.message}`);
  return data || "";
}

// Sobe um anexo (binário) para a task no ClickUp, com algumas tentativas.
async function uploadAttachment(
  supabase: any, apiKey: string, taskId: string, att: { path: string; name?: string; mime?: string },
): Promise<string | null> {
  // Baixa o binário via service key (ignora RLS, não depende de URL assinada que expira).
  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(att.path);
  if (dlErr || !blob) {
    console.error("download attachment err", att.path, dlErr?.message);
    return null;
  }
  const filename = att.name || att.path.split("/").pop() || "arquivo";

  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const form = new FormData();
      form.append("attachment", blob, filename);
      const r = await fetch(`${CLICKUP_API}/task/${taskId}/attachment`, {
        method: "POST",
        headers: { "Authorization": apiKey }, // NÃO setar Content-Type: o FormData define o boundary
        body: form,
      });
      const txt = await r.text();
      if (r.ok) {
        let j: any = null; try { j = JSON.parse(txt); } catch (_) { /* ignore */ }
        return j?.id ? String(j.id) : "ok";
      }
      lastErr = `${r.status} ${txt}`;
      console.error(`attachment upload falhou (tentativa ${attempt})`, att.path, lastErr);
    } catch (e) {
      lastErr = String((e as any)?.message || e);
      console.error(`attachment upload exception (tentativa ${attempt})`, att.path, lastErr);
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  let body: any = {}; try { body = await req.json(); } catch (_) { body = {}; }
  const { message_id } = body;
  if (!message_id) {
    return new Response(JSON.stringify({ error: "message_id obrigatório" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Auth
    const provided = req.headers.get("x-internal-key") || "";
    const internalKey = await getSecret(supabase, "clickup_sync_internal_key");
    const okInternal = internalKey && provided === internalKey;
    const auth = req.headers.get("Authorization") || "";
    const bearer = auth.replace(/^Bearer /i, "").trim();
    const okService  = SERVICE_KEY.length > 20 && bearer === SERVICE_KEY;
    if (!okInternal && !okService) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    // Busca a mensagem (inclui anexos + estado de sync de anexos)
    const { data: msg } = await supabase.schema("portal")
      .from("demand_messages")
      .select("id, demand_id, user_id, content, clickup_comment_id, origin, attachments, clickup_attachments")
      .eq("id", message_id).maybeSingle();
    if (!msg) {
      return new Response(JSON.stringify({ ok: true, skipped: "unknown_message" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Mensagem que VEIO do ClickUp não volta (eco)
    if (msg.origin === "clickup") {
      return new Response(JSON.stringify({ ok: true, skipped: "origin_clickup" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Busca a demanda para pegar clickup_task_id
    const { data: demand } = await supabase.schema("portal")
      .from("demands").select("id, clickup_task_id").eq("id", msg.demand_id).maybeSingle();
    if (!demand?.clickup_task_id) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_clickup_task" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const taskId = demand.clickup_task_id;
    const apiKey = await getSecret(supabase, "clickup_api_key");

    const attachments: Array<{ path: string; name?: string; mime?: string }> =
      Array.isArray(msg.attachments) ? msg.attachments : [];
    const hasAttachments = attachments.length > 0;

    // ── 1) Comentário de crédito do autor ────────────────────────────────
    // Posta só se ainda não há comentário (idempotente). Mesmo em mensagem só
    // de imagem, garante o clickup_comment_id (necessário para a dedupe reversa).
    let commentId: string | null = msg.clickup_comment_id || null;
    if (!commentId) {
      const { data: author } = await supabase.schema("portal")
        .from("users").select("name, email, role, clickup_user_id").eq("id", msg.user_id).maybeSingle();
      const prefix = author?.name
        ? `**${author.name}** (${author.role === "user" ? "cliente" : author.role === "operator" ? "operador" : "admin"}):\n`
        : "";
      const text = (msg.content || "").trim();
      const commentText = prefix + (text || (hasAttachments ? "📎 (anexo)" : ""));
      const payload: any = { comment_text: commentText, notify_all: true };
      if (author?.clickup_user_id) payload.assignee = Number(author.clickup_user_id);

      const r = await fetch(`${CLICKUP_API}/task/${taskId}/comment`, {
        method: "POST",
        headers: { "Authorization": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const respTxt = await r.text();
      let respJson: any = null; try { respJson = JSON.parse(respTxt); } catch (_) { respJson = respTxt; }
      if (!r.ok) {
        console.error("ClickUp comment err", r.status, respTxt);
        return new Response(JSON.stringify({ error: "clickup_failed", status: r.status, body: respJson }), { status: 502, headers: { "Content-Type": "application/json" } });
      }
      commentId = respJson?.id ? String(respJson.id) : null;
      if (commentId) {
        const { error: upErr } = await supabase.schema("portal")
          .from("demand_messages").update({ clickup_comment_id: commentId }).eq("id", msg.id);
        if (upErr) console.error("persist clickup_comment_id err", upErr.message);
      }
    }

    // ── 2) Anexos (binários) ─────────────────────────────────────────────
    let attachResult: { total: number; synced: number } = { total: 0, synced: 0 };
    if (hasAttachments) {
      const already: Array<{ path: string; clickup_id: string }> =
        Array.isArray(msg.clickup_attachments) ? msg.clickup_attachments : [];
      const doneSet = new Set(already.map((a) => a.path));
      const synced = [...already];

      for (const att of attachments) {
        if (!att?.path || doneSet.has(att.path)) continue;
        const cid = await uploadAttachment(supabase, apiKey, taskId, att);
        if (cid) synced.push({ path: att.path, clickup_id: cid });
      }

      attachResult = { total: attachments.length, synced: synced.length };
      const allDone = synced.length >= attachments.length;
      const { error: aErr } = await supabase.schema("portal")
        .from("demand_messages")
        .update({
          clickup_attachments: synced,
          clickup_attachments_synced_at: allDone ? new Date().toISOString() : null,
        })
        .eq("id", msg.id);
      if (aErr) console.error("persist clickup_attachments err", aErr.message);

      // Se ficou anexo pendente, sinaliza 502 para visibilidade nos logs (o cron reprocessa).
      if (!allDone) {
        return new Response(JSON.stringify({ ok: false, partial: true, message_id: msg.id, ...attachResult }), { status: 502, headers: { "Content-Type": "application/json" } });
      }
    }

    return new Response(JSON.stringify({ ok: true, message_id: msg.id, clickup_comment_id: commentId, attachments: attachResult }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
