// send-email v7 — e-mails transacionais do portal (Resend).
// Disparada por triggers pg_net:
//   • _notify_demanda_criada           → { type:'demanda_criada', demand_id }
//   • _notify_projeto_criado           → { type:'projeto_criado', project_id }
//   • _notify_demand_status_change     → demanda_em_revisao | demanda_concluida |
//                                        demanda_cancelada | demanda_ajustes (+demand_id, stamp)
//   • _notify_nova_mensagem            → { type:'nova_mensagem', message_id }
//   • _retry_failed_emails (cron 5min) → { type:'retry_failed' }
//
// D1: cada e-mail é logado em portal.email_log; falha NÃO se perde (status='failed'
//     + attempts/next_attempt_at). O retry_failed reenvia em background e atualiza a
//     MESMA linha (sem duplicar). dedup_key (índice único) é o backstop anti-duplicidade.
// D2: notificação de chat ao cliente (autor ≠ cliente) com dedup por janela de 10 min.
//
// Provider-agnóstico: trocar de provedor mexe só em sendViaProvider() + secret do Vault.
//
// ⚠️ Fonte da verdade vive no Supabase (deploy via `supabase functions deploy`).
// Este arquivo é a cópia versionada — mantenha em sincronia ao editar a função.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const FROM       = "Diamantes <nao-responder@diamantes.grupoparticipa.app.br>";
const PORTAL_URL = "https://diamantes.grupoparticipa.app.br";

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

async function getSecret(supabase: any, name: string): Promise<string> {
  const { data, error } = await supabase.schema("portal").rpc("get_internal_secret", { p_name: name });
  if (error) throw new Error(`secret ${name}: ${error.message}`);
  return data || "";
}

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

const firstName = (n?: string | null) => (n ? " " + esc(n.split(" ")[0]) : "");

async function resolveClientRecipient(supabase: any, entity: any): Promise<{ email: string; name: string } | null> {
  if (entity?.client_slug) {
    const { data } = await supabase.schema("portal").from("users")
      .select("email, name, is_primary")
      .eq("client_slug", entity.client_slug).eq("role", "user")
      .not("email", "is", null)
      .order("is_primary", { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle();
    if (data?.email) return { email: data.email, name: data.name || "" };
  }
  if (entity?.created_by) {
    const { data } = await supabase.schema("portal").from("users")
      .select("email, name, role").eq("id", entity.created_by).maybeSingle();
    if (data?.email && data.role === "user") return { email: data.email, name: data.name || "" };
  }
  return null;
}

// Operadores da demanda (têm e-mail @ — não têm login no portal; CTA aponta ao ClickUp).
async function resolveDemandOperators(supabase: any, demand_id: string): Promise<Array<{ email: string; name: string }>> {
  const { data: dops } = await supabase.schema("portal")
    .from("demand_operators").select("operator_id").eq("demand_id", demand_id);
  const ids = (dops || []).map((d: any) => d.operator_id);
  if (!ids.length) return [];
  const { data: ops } = await supabase.schema("portal")
    .from("operators").select("name, email").in("id", ids).not("email", "is", null);
  return (ops || []).filter((o: any) => o.email).map((o: any) => ({ email: o.email, name: o.name || "" }));
}

type Spec = { to: string; name?: string; subject: string; html: string; dedupKey: string | null; refType: string | null; refId: string | null };

// Compõe as especificações de e-mail (0..n) para (type, payload). Sem enviar/logar.
async function composeSpecs(supabase: any, type: string, payload: any): Promise<Spec[]> {
  const { demand_id, project_id, message_id, stamp } = payload;

  if (type === "demanda_criada") {
    const { data: d } = await supabase.schema("portal").from("demands")
      .select("id, title, client_slug, created_by, status").eq("id", demand_id).maybeSingle();
    if (!d) return [];
    const to = await resolveClientRecipient(supabase, d); if (!to) return [];
    return [{
      to: to.email, name: to.name, dedupKey: `demanda_criada:${demand_id}`, refType: "demand", refId: demand_id,
      subject: `Demanda registrada: ${d.title}`,
      html: baseLayout({ title: "Sua demanda foi registrada ✅",
        intro: `Olá${firstName(to.name)}, recebemos sua demanda <strong>${esc(d.title)}</strong>. Nossa equipe já foi notificada e você acompanha tudo pelo portal.`,
        bodyHtml: "", ctaLabel: "Acompanhar demanda", ctaHref: `${PORTAL_URL}/portal/demandas` }),
    }];
  }

  if (type === "projeto_criado") {
    const { data: p } = await supabase.schema("portal").from("projects")
      .select("id, title, client_slug, created_by").eq("id", project_id).maybeSingle();
    if (!p) return [];
    const to = await resolveClientRecipient(supabase, p); if (!to) return [];
    const title = p.title || "Novo projeto";
    return [{
      to: to.email, name: to.name, dedupKey: `projeto_criado:${project_id}`, refType: "project", refId: project_id,
      subject: `Projeto criado: ${title}`,
      html: baseLayout({ title: "Seu projeto foi criado 🎯",
        intro: `Olá${firstName(to.name)}, criamos o projeto <strong>${esc(title)}</strong>. O próximo passo é preencher o briefing para a equipe começar a trabalhar.`,
        bodyHtml: "", ctaLabel: "Preencher briefing", ctaHref: `${PORTAL_URL}/portal/briefing/${p.id}` }),
    }];
  }

  if (type === "demanda_em_revisao") {
    const { data: d } = await supabase.schema("portal").from("demands")
      .select("id, title, client_slug, created_by, status").eq("id", demand_id).maybeSingle();
    if (!d || d.status !== "review") return [];
    const to = await resolveClientRecipient(supabase, d); if (!to) return [];
    return [{
      to: to.email, name: to.name, dedupKey: `demanda_em_revisao:${demand_id}:${stamp || ""}`, refType: "demand", refId: demand_id,
      subject: `Pronta para sua aprovação: ${d.title}`,
      html: baseLayout({ title: "Sua demanda foi finalizada ✨",
        intro: `Olá${firstName(to.name)}, a equipe concluiu o trabalho da demanda <strong>${esc(d.title)}</strong> e enviou para a sua aprovação. Revise a entrega e, se estiver tudo certo, aprove — ou peça ajustes pelo portal.`,
        bodyHtml: "", ctaLabel: "Revisar e aprovar", ctaHref: `${PORTAL_URL}/portal/demandas?d=${demand_id}` }),
    }];
  }

  if (type === "demanda_concluida") {
    const { data: d } = await supabase.schema("portal").from("demands")
      .select("id, title, client_slug, created_by, status").eq("id", demand_id).maybeSingle();
    if (!d || d.status !== "done") return [];
    const to = await resolveClientRecipient(supabase, d); if (!to) return [];
    return [{
      to: to.email, name: to.name, dedupKey: `demanda_concluida:${demand_id}`, refType: "demand", refId: demand_id,
      subject: `Demanda concluída: ${d.title}`,
      html: baseLayout({ title: "Demanda concluída ✅",
        intro: `Olá${firstName(to.name)}, a demanda <strong>${esc(d.title)}</strong> foi marcada como concluída. Obrigado! Se precisar de algo novo, é só abrir outra demanda pelo portal.`,
        bodyHtml: "", ctaLabel: "Ver minhas demandas", ctaHref: `${PORTAL_URL}/portal/demandas` }),
    }];
  }

  if (type === "demanda_cancelada") {
    const { data: d } = await supabase.schema("portal").from("demands")
      .select("id, title, client_slug, created_by, status").eq("id", demand_id).maybeSingle();
    if (!d || d.status !== "canceled") return [];
    const to = await resolveClientRecipient(supabase, d); if (!to) return [];
    return [{
      to: to.email, name: to.name, dedupKey: `demanda_cancelada:${demand_id}`, refType: "demand", refId: demand_id,
      subject: `Demanda cancelada: ${d.title}`,
      html: baseLayout({ title: "Demanda cancelada",
        intro: `Olá${firstName(to.name)}, a demanda <strong>${esc(d.title)}</strong> foi cancelada. Se isso não era esperado ou precisar reabrir, fale com a equipe pelo portal.`,
        bodyHtml: "", ctaLabel: "Abrir o portal", ctaHref: `${PORTAL_URL}/portal/demandas` }),
    }];
  }

  // Cliente pediu ajustes (review → in_progress): avisa os OPERADORES (CTA p/ ClickUp).
  if (type === "demanda_ajustes") {
    const { data: d } = await supabase.schema("portal").from("demands")
      .select("id, title, status, clickup_task_id").eq("id", demand_id).maybeSingle();
    if (!d || d.status !== "in_progress") return [];
    const ops = await resolveDemandOperators(supabase, demand_id);
    if (!ops.length) return [];
    const ctaHref = d.clickup_task_id ? `https://app.clickup.com/t/${d.clickup_task_id}` : `${PORTAL_URL}`;
    return ops.map((op) => ({
      to: op.email, name: op.name, dedupKey: `demanda_ajustes:${demand_id}:${stamp || ""}:${op.email}`,
      refType: "demand", refId: demand_id,
      subject: `Ajustes solicitados: ${d.title}`,
      html: baseLayout({ title: "O cliente pediu ajustes 🔧",
        intro: `Olá${firstName(op.name)}, o cliente revisou a demanda <strong>${esc(d.title)}</strong> e pediu ajustes. A demanda voltou para "em andamento" — confira os comentários na tarefa do ClickUp.`,
        bodyHtml: "", ctaLabel: "Abrir tarefa no ClickUp", ctaHref }),
    }));
  }

  // Resposta no chat → avisa o CLIENTE (se o autor não for o próprio cliente).
  if (type === "nova_mensagem") {
    const { data: m } = await supabase.schema("portal").from("demand_messages")
      .select("id, demand_id, user_id, origin").eq("id", message_id).maybeSingle();
    if (!m || m.origin === "clickup") return [];
    const { data: author } = await supabase.schema("portal").from("users")
      .select("role").eq("id", m.user_id).maybeSingle();
    if (author?.role === "user") return []; // o próprio cliente escreveu → não notifica ele
    const { data: d } = await supabase.schema("portal").from("demands")
      .select("id, title, client_slug, created_by").eq("id", m.demand_id).maybeSingle();
    if (!d) return [];
    const to = await resolveClientRecipient(supabase, d); if (!to) return [];
    // Dedup por janela de 10 min: no máximo 1 e-mail de "nova mensagem" por demanda/10min.
    const window = Math.floor(Date.now() / 600000);
    return [{
      to: to.email, name: to.name, dedupKey: `chat:${m.demand_id}:${window}`, refType: "message", refId: message_id,
      subject: `Nova mensagem na demanda: ${d.title}`,
      html: baseLayout({ title: "Você tem uma nova mensagem 💬",
        intro: `Olá${firstName(to.name)}, a equipe respondeu na demanda <strong>${esc(d.title)}</strong>. Abra o portal para ver a mensagem e responder.`,
        bodyHtml: "", ctaLabel: "Ver conversa", ctaHref: `${PORTAL_URL}/portal/demandas?d=${m.demand_id}` }),
    }];
  }

  return [];
}

// Envio inicial: só envia se NÃO existe linha para o dedup_key (evita duplicidade);
// loga o resultado (failed mantém attempts/next_attempt_at p/ o retry cron).
async function executeInitial(supabase: any, apiKey: string, type: string, spec: Spec) {
  if (spec.dedupKey) {
    const { data: existing } = await supabase.schema("portal").from("email_log")
      .select("id").eq("dedup_key", spec.dedupKey).limit(1).maybeSingle();
    if (existing) return { skipped: "dedup" };
  }
  const res = await sendViaProvider(apiKey, spec.to, spec.subject, spec.html);
  const row: any = {
    type, to_email: spec.to, subject: spec.subject, ref_type: spec.refType, ref_id: spec.refId,
    dedup_key: spec.dedupKey, status: res.ok ? "sent" : "failed",
    resend_id: res.id || null, error: res.error || null,
    attempts: 1, next_attempt_at: res.ok ? null : new Date(Date.now() + 5 * 60000).toISOString(),
  };
  const { error: insErr } = await supabase.schema("portal").from("email_log").insert(row);
  if (insErr) return { skipped: "log_conflict" }; // unique(dedup_key) → outra execução já registrou
  return res.ok ? { sent: spec.to } : { failed: res.error };
}

// Retry (cron): reenvia linhas 'failed' devidas, ATUALIZANDO a mesma linha (sem duplicar).
async function runRetry(supabase: any, apiKey: string) {
  const nowIso = new Date().toISOString();
  const { data: rows } = await supabase.schema("portal").from("email_log")
    .select("id, type, ref_id, to_email, attempts, max_attempts")
    .eq("status", "failed")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .gt("created_at", new Date(Date.now() - 3 * 86400000).toISOString())
    .limit(25);
  let processed = 0, sent = 0;
  for (const row of (rows || [])) {
    if (row.attempts >= (row.max_attempts ?? 3)) {
      await supabase.schema("portal").from("email_log").update({ status: "gaveup" }).eq("id", row.id);
      continue;
    }
    processed++;
    const payload: any = {};
    if (row.type === "projeto_criado") payload.project_id = row.ref_id;
    else if (row.type === "nova_mensagem") payload.message_id = row.ref_id;
    else payload.demand_id = row.ref_id;

    const specs = await composeSpecs(supabase, row.type, payload);
    const spec = specs.find((s) => s.to === row.to_email) || specs[0];
    const attempts = (row.attempts ?? 1) + 1;
    if (!spec) {
      await supabase.schema("portal").from("email_log").update({ status: "skipped", attempts }).eq("id", row.id);
      continue;
    }
    const res = await sendViaProvider(apiKey, spec.to, spec.subject, spec.html);
    if (res.ok) sent++;
    await supabase.schema("portal").from("email_log").update({
      status: res.ok ? "sent" : "failed",
      resend_id: res.id || null, error: res.error || null, attempts,
      next_attempt_at: res.ok ? null : new Date(Date.now() + attempts * 5 * 60000).toISOString(),
    }).eq("id", row.id);
  }
  return { processed, sent };
}

Deno.serve(async (req: Request) => {
  let body: any = {}; try { body = await req.json(); } catch (_) { body = {}; }
  const { type } = body;

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const provided = req.headers.get("x-internal-key") || "";
    const auth     = req.headers.get("Authorization") || "";
    const bearer   = auth.replace(/^Bearer /i, "").trim();
    const internalKey = await getSecret(supabase, "clickup_sync_internal_key");
    const okInternal = internalKey && provided === internalKey;
    const okService  = SERVICE_KEY.length > 20 && bearer === SERVICE_KEY;
    if (!okInternal && !okService) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const apiKey = await getSecret(supabase, "resend_api_key");
    if (!apiKey) return new Response(JSON.stringify({ error: "resend_api_key ausente" }), { status: 500, headers: { "Content-Type": "application/json" } });

    if (type === "retry_failed") {
      const r = await runRetry(supabase, apiKey);
      return new Response(JSON.stringify({ ok: true, type, ...r }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (type === "custom") {
      const { to, subject, html } = body;
      if (!to || !subject) return new Response(JSON.stringify({ error: "to e subject obrigatórios" }), { status: 400, headers: { "Content-Type": "application/json" } });
      const res = await sendViaProvider(apiKey, to, subject, html || "<p>(sem corpo)</p>");
      await supabase.schema("portal").from("email_log").insert({
        type: "custom", to_email: to, subject, status: res.ok ? "sent" : "failed",
        resend_id: res.id || null, error: res.error || null, attempts: 1,
      });
      return new Response(JSON.stringify({ ok: true, type, ...(res.ok ? { sent: to } : { failed: res.error }) }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const KNOWN = ["demanda_criada","projeto_criado","demanda_em_revisao","demanda_concluida","demanda_cancelada","demanda_ajustes","nova_mensagem"];
    if (!KNOWN.includes(type)) {
      return new Response(JSON.stringify({ error: `type inválido: ${type}` }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const specs = await composeSpecs(supabase, type, body);
    if (!specs.length) {
      return new Response(JSON.stringify({ ok: true, type, skipped: "no_recipient_or_state" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const results = [];
    for (const spec of specs) results.push(await executeInitial(supabase, apiKey, type, spec));
    return new Response(JSON.stringify({ ok: true, type, results }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
