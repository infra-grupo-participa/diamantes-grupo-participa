/**
 * Templates dos e-mails de autenticação enviados pelo app (via Resend/EF send-email).
 *
 * Ficam aqui, e não em Authentication → Email Templates do Supabase, porque o envio
 * do link não passa mais pelo SMTP do Auth: o link é gerado com `admin.generateLink`
 * e embutido no HTML abaixo. Visual espelhado de supabase/functions/send-email.
 */

const C = {
  bg: '#f7f4fc',
  surface: '#ffffff',
  text: '#1a1430',
  muted: '#6b6584',
  border: '#e7e2f3',
  accent: '#f29725',
  tint: '#efe8fb',
};

export type EmailTemplate = { subject: string; html: string };

function esc(s: string): string {
  return (s || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

const firstName = (n?: string | null) => (n ? ' ' + esc(n.split(' ')[0]) : '');

function layout(opts: {
  title: string;
  intro: string;
  ctaLabel: string;
  ctaHref: string;
  footnote: string;
}): string {
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
    </td></tr>
    <tr><td style="padding:8px 28px 24px;">
      <a href="${esc(opts.ctaHref)}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 24px;border-radius:10px;">${esc(opts.ctaLabel)}</a>
    </td></tr>
    <tr><td style="padding:0 28px 32px;">
      <p style="margin:0;font-size:13px;line-height:1.55;color:${C.muted};">${opts.footnote}</p>
    </td></tr>
    <tr><td style="padding:20px 28px;background:${C.bg};border-top:1px solid ${C.border};">
      <p style="margin:0;font-size:12px;line-height:1.5;color:${C.muted};">
        Não consegue clicar no botão? Copie e cole este endereço no navegador:<br>
        <span style="word-break:break-all;color:${C.text};">${esc(opts.ctaHref)}</span>
      </p>
    </td></tr>
  </table>
  <div style="max-width:560px;margin-top:16px;font-size:11px;color:${C.muted};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">© Grupo Participa · Programa Diamantes</div>
</td></tr></table></body></html>`;
}

/** Redefinição de senha solicitada pelo próprio usuário ("esqueci minha senha"). */
export function resetPasswordEmail(link: string, name?: string | null): EmailTemplate {
  return {
    subject: 'Redefinir sua senha — Portal Diamantes',
    html: layout({
      title: 'Redefinição de senha 🔒',
      intro: `Olá${firstName(name)}, recebemos um pedido para redefinir a senha da sua conta no Portal Diamantes. Clique no botão abaixo para criar uma nova senha. Este link vale por 1 hora e só pode ser usado uma vez.`,
      ctaLabel: 'Criar nova senha',
      ctaHref: link,
      footnote: 'Se você não solicitou isso, ignore este e-mail — sua senha continua a mesma.',
    }),
  };
}

/** Primeiro acesso: conta criada pelo admin, o aluno define a senha pelo link. */
export function firstAccessEmail(link: string, name?: string | null): EmailTemplate {
  return {
    subject: 'Seu acesso ao Portal Diamantes',
    html: layout({
      title: 'Bem-vindo ao Portal Diamantes 💎',
      intro: `Olá${firstName(name)}, sua conta no Portal Diamantes está pronta. Para entrar pela primeira vez, defina sua senha no botão abaixo. Este link vale por 1 hora — se expirar, use "Esqueci minha senha" na tela de login.`,
      ctaLabel: 'Definir minha senha',
      ctaHref: link,
      footnote: 'Depois de definir a senha, use seu e-mail e ela para entrar no portal.',
    }),
  };
}
