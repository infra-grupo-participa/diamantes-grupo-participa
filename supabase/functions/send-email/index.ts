// send-email v5 — e-mails transacionais do portal (Resend).
// Disparada por triggers pg_net:
//   • portal._notify_demanda_criada     → { type:'demanda_criada', demand_id }
//   • portal._notify_projeto_criado     → { type:'projeto_criado', project_id }
//   • portal._notify_demanda_em_revisao → { type:'demanda_em_revisao', demand_id, stamp }
// (Nova mensagem NÃO dispara e-mail: o ClickUp já notifica. Reset de senha é via
//  SMTP do Supabase Auth.)
//
// Provider-agnóstico: a troca de provedor mexe só em sendViaProvider() + no
// secret do Vault. Dedup "uma vez só" via portal.email_log (dedup_key).
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

async function handleProjetoCriado(supabase: any, apiKey: string, project_id: string) {
  const { data: project } = await supabase.schema("portal")
    .from("projects").select("id, title, client_slug, created_by").eq("id", project_id).maybeSingle();
  if (!project) return { skipped: "unknown_project" };

  const dedupKey = `projeto_criado:${project_id}`;
  const { data: dup } = await supabase.schema("portal").from("email_log")
    .select("id").eq("dedup_key", dedupKey).eq("status", "sent").limit(1).maybeSingle();
  if (dup) return { skipped: "already_sent" };

  const to = await resolveClientRecipient(supabase, project);
  if (!to) return { skipped: "no_recipient" };

  const title = project.title || "Novo projeto";
  const subject = `Projeto criado: ${title}`;
  const html = baseLayout({
    title: "Seu projeto foi criado 🎯",
    intro: `Olá${to.name ? " " + esc(to.name.split(" ")[0]) : ""}, criamos o projeto <strong>${esc(title)}</strong>. O próximo passo é preencher o briefing para a equipe começar a trabalhar.`,
    bodyHtml: "",
    ctaLabel: "Preencher briefing",
    ctaHref: `${PORTAL_URL}/portal/briefing/${project.id}`,
  });

  const res = await sendViaProvider(apiKey, to.email, subject, html);
  await logEmail(supabase, {
    type: "projeto_criado", to_email: to.email, subject,
    ref_type: "project", ref_id: project_id, dedup_key: res.ok ? dedupKey : null,
    status: res.ok ? "sent" : "failed", resend_id: res.id || null, error: res.error || null,
  });
  return res.ok ? { sent: to.email } : { failed: res.error };
}

// Demanda finalizada pela equipe (entrou em "em revisão") → cliente precisa aprovar.
// `stamp` (clock_timestamp da transição, vindo do trigger) dedupa a MESMA transição
// (retries) sem bloquear futuras revisões (pedir ajustes → equipe refinaliza → review).
async function handleDemandaEmRevisao(supabase: any, apiKey: string, demand_id: string, stamp?: string) {
  const { data: demand } = await supabase.schema("portal")
    .from("demands").select("id, title, client_slug, created_by, status").eq("id", demand_id).maybeSingle();
  if (!demand) return { skipped: "unknown_demand" };
  if (demand.status !== "review") return { skipped: "not_in_review" };

  const dedupKey = `demanda_em_revisao:${demand_id}:${stamp || ""}`;
  const { data: dup } = await supabase.schema("portal").from("email_log")
    .select("id").eq("dedup_key", dedupKey).eq("status", "sent").limit(1).maybeSingle();
  if (dup) return { skipped: "already_sent" };

  const to = await resolveClientRecipient(supabase, demand);
  if (!to) return { skipped: "no_recipient" };

  const subject = `Pronta para sua aprovação: ${demand.title}`;
  const html = baseLayout({
    title: "Sua demanda foi finalizada ✨",
    intro: `Olá${to.name ? " " + esc(to.name.split(" ")[0]) : ""}, a equipe concluiu o trabalho da demanda <strong>${esc(demand.title)}</strong> e enviou para a sua aprovação. Revise a entrega e, se estiver tudo certo, aprove — ou peça ajustes pelo portal.`,
    bodyHtml: "",
    ctaLabel: "Revisar e aprovar",
    ctaHref: `${PORTAL_URL}/portal/demandas?d=${demand_id}`,
  });

  const res = await sendViaProvider(apiKey, to.email, subject, html);
  await logEmail(supabase, {
    type: "demanda_em_revisao", to_email: to.email, subject,
    ref_type: "demand", ref_id: demand_id, dedup_key: res.ok ? dedupKey : null,
    status: res.ok ? "sent" : "failed", resend_id: res.id || null, error: res.error || null,
  });
  return res.ok ? { sent: to.email } : { failed: res.error };
}

Deno.serve(async (req: Request) => {
  let body: any = {}; try { body = await req.json(); } catch (_) { body = {}; }
  const { type, demand_id, project_id, to, subject, html } = body;

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Auth: x-internal-key (mesmo segredo interno do ClickUp) ou service-role.
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

    const apiKey = await getSecret(supabase, "resend_api_key");
    if (!apiKey) return new Response(JSON.stringify({ error: "resend_api_key ausente" }), { status: 500, headers: { "Content-Type": "application/json" } });

    let result: any;
    switch (type) {
      case "demanda_criada":
        if (!demand_id) return new Response(JSON.stringify({ error: "demand_id obrigatório" }), { status: 400, headers: { "Content-Type": "application/json" } });
        result = await handleDemandaCriada(supabase, apiKey, demand_id);
        break;
      case "projeto_criado":
        if (!project_id) return new Response(JSON.stringify({ error: "project_id obrigatório" }), { status: 400, headers: { "Content-Type": "application/json" } });
        result = await handleProjetoCriado(supabase, apiKey, project_id);
        break;
      case "demanda_em_revisao":
        if (!demand_id) return new Response(JSON.stringify({ error: "demand_id obrigatório" }), { status: 400, headers: { "Content-Type": "application/json" } });
        result = await handleDemandaEmRevisao(supabase, apiKey, demand_id, body.stamp);
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
