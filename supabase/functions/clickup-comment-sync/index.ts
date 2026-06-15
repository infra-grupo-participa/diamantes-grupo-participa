// clickup-comment-sync — portal.demand_messages → comentário no ClickUp.
// Chamada pela trigger pg_net (portal._sync_message_to_clickup) quando uma
// mensagem nova é inserida em portal.demand_messages.
//
// ⚠️ Fonte da verdade vive no Supabase (deploy via `supabase functions deploy`).
// Este arquivo é a cópia versionada — mantenha em sincronia ao editar a função.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CLICKUP_API  = "https://api.clickup.com/api/v2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

async function getSecret(supabase: any, name: string): Promise<string> {
  const { data, error } = await supabase.schema("portal")
    .rpc("get_internal_secret", { p_name: name });
  if (error) throw new Error(`secret ${name}: ${error.message}`);
  return data || "";
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
    const okService  = auth.includes(SERVICE_KEY) && SERVICE_KEY.length > 20;
    if (!okInternal && !okService) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    // Busca a mensagem
    const { data: msg } = await supabase.schema("portal")
      .from("demand_messages")
      .select("id, demand_id, user_id, content, clickup_comment_id, origin")
      .eq("id", message_id).maybeSingle();
    if (!msg) {
      return new Response(JSON.stringify({ ok: true, skipped: "unknown_message" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Já veio do ClickUp — não eco de volta
    if (msg.origin === "clickup" || msg.clickup_comment_id) {
      return new Response(JSON.stringify({ ok: true, skipped: "origin_clickup" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Busca a demanda para pegar clickup_task_id
    const { data: demand } = await supabase.schema("portal")
      .from("demands").select("id, clickup_task_id").eq("id", msg.demand_id).maybeSingle();
    if (!demand?.clickup_task_id) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_clickup_task" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Busca o nome/email do autor pra prefixar o comentário (ClickUp só atribui ao dono do token)
    const { data: author } = await supabase.schema("portal")
      .from("users").select("name, email, role, clickup_user_id").eq("id", msg.user_id).maybeSingle();
    const prefix = author?.name
      ? `**${author.name}** (${author.role === "user" ? "cliente" : author.role === "operator" ? "operador" : "admin"}):\n`
      : "";
    const commentText = prefix + (msg.content || "");

    // Posta no ClickUp
    const apiKey = await getSecret(supabase, "clickup_api_key");
    const payload: any = { comment_text: commentText, notify_all: true };
    // Se o autor tem clickup_user_id, atribui o comentário a ele
    if (author?.clickup_user_id) {
      payload.assignee = Number(author.clickup_user_id);
    }
    const r = await fetch(`${CLICKUP_API}/task/${demand.clickup_task_id}/comment`, {
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

    const commentId = respJson?.id ? String(respJson.id) : null;
    if (commentId) {
      await supabase.schema("portal")
        .from("demand_messages").update({ clickup_comment_id: commentId }).eq("id", msg.id);
    }

    return new Response(JSON.stringify({ ok: true, message_id: msg.id, clickup_comment_id: commentId }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
