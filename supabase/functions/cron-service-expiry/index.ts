// cron-service-expiry — avisa o cliente por e-mail quando um serviço está perto de
// vencer ou acabou de vencer. Disparada por pg_cron (portal._notify_expiring_services).
//
// Marcos de aviso (days_left): 7, 3, 1, 0 (vence hoje) e -1 (venceu ontem). Limitar a
// marcos evita spam e evita disparar sobre serviços vencidos há muito tempo.
// Dedup por (serviço, access_until, marco) via portal.email_log → 1 e-mail por marco.
//
// ⚠️ Fonte da verdade vive no Supabase (deploy via `supabase functions deploy`).
// Este arquivo é a cópia versionada — mantenha em sincronia ao editar a função.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const FROM       = "Diamantes <nao-responder@diamantes.grupoparticipa.app.br>";
const PORTAL_URL = "https://diamantes.grupoparticipa.app.br";
const MILESTONES = [7, 3, 1, 0, -1];

const C = { bg: "#f7f4fc", surface: "#ffffff", text: "#1a1430", muted: "#6b6584", border: "#e7e2f3", accent: "#f29725", tint: "#efe8fb" };

function esc(s: string): string {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function layout(title: string, intro: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 16px;"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.surface};border:1px solid ${C.border};border-radius:16px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <tr><td style="background:${C.tint};padding:24px 28px;border-bottom:1px solid ${C.border};">
      <span style="font-size:20px;font-weight:800;letter-spacing:.5px;color:${C.text};">Diamantes</span>
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${C.accent};margin-left:6px;vertical-align:middle;"></span>
      <div style="font-size:12px;color:${C.muted};margin-top:2px;">Grupo Participa</div></td></tr>
    <tr><td style="padding:32px 28px 8px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:${C.text};font-weight:700;">${esc(title)}</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.text};">${intro}</p></td></tr>
    <tr><td style="padding:8px 28px 32px;">
      <a href="${PORTAL_URL}/portal" style="display:inline-block;background:${C.accent};color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 24px;border-radius:10px;">Acessar o portal</a></td></tr>
    <tr><td style="padding:20px 28px;background:${C.bg};border-top:1px solid ${C.border};">
      <p style="margin:0;font-size:12px;line-height:1.5;color:${C.muted};">Para renovar ou tirar dúvidas sobre a cobrança, fale com a equipe. Não responda este e-mail.</p></td></tr>
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

async function recipientFor(supabase: any, clientSlug: string): Promise<{ email: string; name: string } | null> {
  const { data } = await supabase.schema("portal").from("users")
    .select("email, name, is_primary").eq("client_slug", clientSlug).eq("role", "user")
    .not("email", "is", null).order("is_primary", { ascending: false, nullsFirst: false })
    .limit(1).maybeSingle();
  return data?.email ? { email: data.email, name: data.name || "" } : null;
}

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const provided = req.headers.get("x-internal-key") || "";
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer /i, "").trim();
    const internalKey = await getSecret(supabase, "clickup_sync_internal_key");
    const ok = (internalKey && provided === internalKey) || (SERVICE_KEY.length > 20 && bearer === SERVICE_KEY);
    if (!ok) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });

    const apiKey = await getSecret(supabase, "resend_api_key");
    if (!apiKey) return new Response(JSON.stringify({ error: "resend_api_key ausente" }), { status: 500, headers: { "Content-Type": "application/json" } });

    const { data: rows } = await supabase.schema("portal").from("v_service_renewals")
      .select("service_id, client_slug, client_display_name, service_type, access_until, days_left, offer_service_name")
      .in("days_left", MILESTONES);

    let sent = 0, skipped = 0;
    for (const s of (rows || [])) {
      const dl = Number(s.days_left);
      const dedupKey = `servico_expirando:${s.service_id}:${s.access_until}:${dl}`;
      const { data: dup } = await supabase.schema("portal").from("email_log")
        .select("id").eq("dedup_key", dedupKey).limit(1).maybeSingle();
      if (dup) { skipped++; continue; }

      const to = await recipientFor(supabase, s.client_slug);
      if (!to) { skipped++; continue; }

      const svc = s.offer_service_name || s.service_type || "seu serviço";
      let title: string, intro: string, subject: string;
      const first = to.name ? " " + esc(to.name.split(" ")[0]) : "";
      if (dl > 0) {
        title = `Seu serviço vence em ${dl} ${dl === 1 ? "dia" : "dias"} ⏳`;
        subject = `Seu serviço "${svc}" vence em ${dl} ${dl === 1 ? "dia" : "dias"}`;
        intro = `Olá${first}, o serviço <strong>${esc(svc)}</strong> vence em <strong>${dl} ${dl === 1 ? "dia" : "dias"}</strong> (${esc(String(s.access_until))}). Renove para não ter interrupção no atendimento.`;
      } else if (dl === 0) {
        title = "Seu serviço vence hoje ⚠️";
        subject = `Seu serviço "${svc}" vence hoje`;
        intro = `Olá${first}, o serviço <strong>${esc(svc)}</strong> vence <strong>hoje</strong>. Renove para manter tudo funcionando sem interrupção.`;
      } else {
        title = "Seu serviço venceu";
        subject = `Seu serviço "${svc}" venceu`;
        intro = `Olá${first}, o serviço <strong>${esc(svc)}</strong> venceu em ${esc(String(s.access_until))}. Para retomar o atendimento, faça a renovação ou fale com a equipe.`;
      }

      const res = await sendViaProvider(apiKey, to.email, subject, layout(title, intro));
      await supabase.schema("portal").from("email_log").insert({
        type: "servico_expirando", to_email: to.email, subject, ref_type: "service", ref_id: s.service_id,
        dedup_key: res.ok ? dedupKey : null, status: res.ok ? "sent" : "failed",
        resend_id: res.id || null, error: res.error || null, attempts: 1,
      });
      if (res.ok) sent++; else skipped++;
    }

    return new Response(JSON.stringify({ ok: true, sent, skipped, scanned: (rows || []).length }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
