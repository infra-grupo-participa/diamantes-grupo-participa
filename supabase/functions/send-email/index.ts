// send-email v1 — e-mails transacionais do portal (Resend).
// Disparada por triggers pg_net:
//   • portal._notify_demanda_criada  → { type:'demanda_criada', demand_id }
//   • portal._notify_nova_mensagem   → { type:'nova_mensagem',  message_id }
//
// Provider-agnóstico: a troca de provedor mexe só em sendViaProvider() + no
// secret do Vault. Throttle/dedup vivem em portal.email_log.
//
// ⚠️ Fonte da verdade vive no Supabase (deploy via `supabase functions deploy`).
// Este arquivo é a cópia versionada — mantenha em sincronia ao editar a função.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Remetente — domínio a verificar no Resend (DNS SPF/DKIM).
const FROM       = "Diamantes <nao-responder@diamantes.grupoparticipa.app.br>";
const PORTAL_URL = "https://diamantes.grupoparticipa.app.br";
// Cooldown do digest de chat: no máx. 1 e-mail por demanda/destinatário a cada N min.
const CHAT_COOLDOWN_MIN = 30;

// ── Branding (alinhado a app/globals.css) ───────────────────────────
const C = {
  bg: "#f7f4fc", surface: "#ffffff", text: "#1a1430", muted: "#6b6584",
  border: "#e7e2f3", accent: "#f29725", accentStrong: "#d97f15", tint: "#efe8fb",
};

function esc(s: string): string {
  return (s || "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function baseLayout(opts: { title: string; intro: string; bodyHtml: string; ctaLabel: string; ctaHref: string }): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.surface};border:1px solid ${C.border};border-radius:16px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <tr><td style="background:${C.tint};padding:24px 28px;border-bottom:1px solid ${C.border};">
      <span style="font-size:20px;font-weight:800;letter-spacing:.5px;color:${C.text};">Diamantes</span>
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${C.accent};margin-left:6px;vertical-align:middle;"></span>
      <div style="font-size:12px;color:${C.muted};margin-top:2px;">Grupo Participa</div>
    </td></tr>
    <tr><td style="padding:32px 28px 8px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:${C.text};font-weight:700;">${esc(opts.title)}</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.text};">${opts.intro}</p>
      ${opts.bodyHtml}
    </td></tr>
    <tr><td style="padding:8px 28px 32px;">
      <a href="${esc(opts.ctaHref)}" style="display:inline-block;background:${C.accent};color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 24px;border-radius:10px;">${esc(opts.ctaLabel)}</a>
    </td></tr>
    <tr><td style="padding:20px 28px;background:${C.bg};border-top:1px solid ${C.border};">
      <p style="margin:0;font-size:12px;line-height:1.5;color:${C.muted};">Você recebeu este e-mail porque tem uma conta no Portal Diamantes. Não responda esta mensagem — fale com a equipe diretamente pelo portal.</p>
    </td></tr>
  </table>
  <div style="max-width:560px;margin-top:16px;font-size:11px;color:${C.muted};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">© Grupo Participa · Programa Diamantes</div>
</td></tr></table></body></html>`;
}

function quoteBox(author: string, text: string): string {
  const preview = text.length > 320 ? text.slice(0, 320) + "…" : text;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr><td style="background:${C.bg};border:1px solid ${C.border};border-left:3px solid ${C.accent};border-radius:10px;padding:14px 16px;">
      <div style="font-size:13px;font-weight:700;color:${C.text};margin-bottom:4px;">${esc(author)}</div>
      <div style="font-size:14px;line-height:1.55;color:${C.text};white-space:pre-wrap;">${esc(preview)}</div>
    </td></tr></table>`;
}

// ── Secrets / provider ──────────────────────────────────────────────
async function getSecret(supabase: any, name: string): Promise<string> {
  const { data, error } = await supabase.schema("portal").rpc("get_internal_secret", { p_name: name });
  if (error) throw new Error(`secret ${name}: ${error.message}`);
  return data || "";
}

// Único ponto acoplado ao provedor. Troca = só aqui + o secret.
async function sendViaProvider(apiKey: string, to: string, subject: string, html: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  const txt = await r.text();
  let j: any = null; try { j = JSON.parse(txt); } catch (_) { j = txt; }
  if (!r.ok) return { ok: false, error: `provider ${r.status}: ${typeof j === "string" ? j : JSON.stringify(j)}` };
  return { ok: true, id: j?.id ? String(j.id) : undefined };
}

async function logEmail(supabase: any, row: any) {
  try { await supabase.schema("portal").from("email_log").insert(row); }
  catch (e) { console.error("email_log insert err", e); }
}

// Destinatário cliente da demanda: usuário primário do client_slug.
async function resolveClientRecipient(supabase: any, demand: any): Promise<{ email: string; name: string } | null> {
  if (demand.client_slug) {
    const { data } = await supabase.schema("portal").from("users")
      .select("email, name, is_primary")
      .eq("client_slug", demand.client_slug).eq("role", "user")
      .not("email", "is", null)
      .order("is_primary", { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle();
    if (data?.email) return { email: data.email, name: data.name || "" };
  }
  if (demand.created_by) {
    const { data } = await supabase.schema("portal").from("users")
      .select("email, name, role").eq("id", demand.created_by).maybeSingle();
    if (data?.email && data.role === "user") return { email: data.email, name: data.name || "" };
  }
  return null;
}

// ── Handlers ────────────────────────────────────────────────────────
async function handleDemandaCriada(supabase: any, apiKey: string, demand_id: string) {
  const { data: demand } = await supabase.schema("portal")
    .from("demands").select("id, title, client_slug, created_by, status").eq("id", demand_id).maybeSingle();
  if (!demand) return { skipped: "unknown_demand" };

  const dedupKey = `demanda_criada:${demand_id}`;
  const { data: dup } = await supabase.schema("portal").from("email_log")
    .select("id").eq("dedup_key", dedupKey).eq("status", "sent").limit(1).maybeSingle();
  if (dup) return { skipped: "already_sent" };

  const to = await resolveClientRecipient(supabase, demand);
  if (!to) return { skipped: "no_recipient" };

  const subject = `Demanda registrada: ${demand.title}`;
  const html = baseLayout({
    title: "Sua demanda foi registrada ✅",
    intro: `Olá${to.name ? " " + esc(to.name.split(" ")[0]) : ""}, recebemos sua demanda <strong>${esc(demand.title)}</strong>. Nossa equipe já foi notificada e você acompanha tudo pelo portal.`,
    bodyHtml: "",
    ctaLabel: "Acompanhar demanda",
    ctaHref: `${PORTAL_URL}/portal/demandas`,
  });

  const res = await sendViaProvider(apiKey, to.email, subject, html);
  await logEmail(supabase, {
    type: "demanda_criada", to_email: to.email, subject,
    ref_type: "demand", ref_id: demand_id, dedup_key: res.ok ? dedupKey : null,
    status: res.ok ? "sent" : "failed", resend_id: res.id || null, error: res.error || null,
  });
  return res.ok ? { sent: to.email } : { failed: res.error };
}

async function handleNovaMensagem(supabase: any, apiKey: string, message_id: string) {
  const { data: msg } = await supabase.schema("portal")
    .from("demand_messages").select("id, demand_id, user_id, content, origin").eq("id", message_id).maybeSingle();
  if (!msg) return { skipped: "unknown_message" };

  // Autor: se for o próprio cliente, não notificamos o cliente.
  const { data: author } = await supabase.schema("portal")
    .from("users").select("name, role").eq("id", msg.user_id).maybeSingle();
  const authorIsClient = author?.role === "user";
  if (authorIsClient && msg.origin !== "clickup") return { skipped: "author_is_client" };

  const { data: demand } = await supabase.schema("portal")
    .from("demands").select("id, title, client_slug, created_by").eq("id", msg.demand_id).maybeSingle();
  if (!demand) return { skipped: "unknown_demand" };

  const to = await resolveClientRecipient(supabase, demand);
  if (!to) return { skipped: "no_recipient" };

  // Throttle: cooldown por (demanda, destinatário).
  const since = new Date(Date.now() - CHAT_COOLDOWN_MIN * 60_000).toISOString();
  const { data: recent } = await supabase.schema("portal").from("email_log")
    .select("id").eq("type", "nova_mensagem").eq("ref_id", msg.demand_id)
    .eq("to_email", to.email).eq("status", "sent").gt("created_at", since).limit(1).maybeSingle();
  if (recent) {
    await logEmail(supabase, {
      type: "nova_mensagem", to_email: to.email, subject: `Nova mensagem: ${demand.title}`,
      ref_type: "demand", ref_id: msg.demand_id, status: "skipped", error: "cooldown",
    });
    return { skipped: "cooldown" };
  }

  const authorName = author?.name || "Equipe Diamantes";
  const subject = `Nova mensagem na demanda: ${demand.title}`;
  const html = baseLayout({
    title: "Você tem uma nova mensagem 💬",
    intro: `<strong>${esc(authorName)}</strong> respondeu na sua demanda <strong>${esc(demand.title)}</strong>:`,
    bodyHtml: quoteBox(authorName, msg.content || ""),
    ctaLabel: "Responder no portal",
    ctaHref: `${PORTAL_URL}/portal/demandas`,
  });

  const res = await sendViaProvider(apiKey, to.email, subject, html);
  await logEmail(supabase, {
    type: "nova_mensagem", to_email: to.email, subject,
    ref_type: "demand", ref_id: msg.demand_id, dedup_key: null,
    status: res.ok ? "sent" : "failed", resend_id: res.id || null, error: res.error || null,
  });
  return res.ok ? { sent: to.email } : { failed: res.error };
}

Deno.serve(async (req: Request) => {
  let body: any = {}; try { body = await req.json(); } catch (_) { body = {}; }
  const { type, demand_id, message_id, to, subject, html } = body;

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Auth: x-internal-key (mesmo segredo interno do ClickUp) ou service-role.
    const provided = req.headers.get("x-internal-key") || "";
    const auth     = req.headers.get("Authorization") || "";
    const internalKey = await getSecret(supabase, "clickup_sync_internal_key");
    const okInternal = internalKey && provided === internalKey;
    const okService  = auth.includes(SERVICE_KEY) && SERVICE_KEY.length > 20;
    if (!okInternal && !okService) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const apiKey = await getSecret(supabase, "resend_api_key");
    if (!apiKey) return new Response(JSON.stringify({ error: "resend_api_key ausente" }), { status: 500, headers: { "Content-Type": "application/json" } });

    let result: any;
    switch (type) {
      case "demanda_criada":
        if (!demand_id) return new Response(JSON.stringify({ error: "demand_id obrigatório" }), { status: 400, headers: { "Content-Type": "application/json" } });
        result = await handleDemandaCriada(supabase, apiKey, demand_id);
        break;
      case "nova_mensagem":
        if (!message_id) return new Response(JSON.stringify({ error: "message_id obrigatório" }), { status: 400, headers: { "Content-Type": "application/json" } });
        result = await handleNovaMensagem(supabase, apiKey, message_id);
        break;
      case "custom": {
        // Teste/manual: { type:'custom', to, subject, html }
        if (!to || !subject) return new Response(JSON.stringify({ error: "to e subject obrigatórios" }), { status: 400, headers: { "Content-Type": "application/json" } });
        const res = await sendViaProvider(apiKey, to, subject, html || "<p>(sem corpo)</p>");
        await logEmail(supabase, { type: "custom", to_email: to, subject, status: res.ok ? "sent" : "failed", resend_id: res.id || null, error: res.error || null });
        result = res.ok ? { sent: to } : { failed: res.error };
        break;
      }
      default:
        return new Response(JSON.stringify({ error: `type inválido: ${type}` }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, type, ...result }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
