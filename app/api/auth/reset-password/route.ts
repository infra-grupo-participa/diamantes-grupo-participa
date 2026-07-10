import { NextResponse } from 'next/server';
import { generateRecoveryLink } from '@/lib/email/recovery-link';
import { resetPasswordEmail } from '@/lib/email/templates';
import { sendTransactionalEmail } from '@/lib/email/send';
import { safeOrigin } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Esqueci minha senha" — gera o link com a service role e envia pelo Resend
 * (EF send-email), em vez de depender do SMTP e do template do Supabase Auth.
 *
 * Responde SEMPRE 200 { ok: true }, mesmo para e-mail inexistente ou falha de envio:
 * a resposta não pode revelar quais e-mails têm conta (anti-enumeração).
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_PER_EMAIL = 3;
const WINDOW_MS = 60 * 60 * 1000;

// Throttle em memória: o app roda como processo único na Hostinger Node App, então
// um Map basta. Protege a cota do Resend (100/dia) de um formulário público.
const attempts = new Map<string, number[]>();

function rateLimited(email: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(email) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_EMAIL) {
    attempts.set(email, recent);
    return true;
  }
  recent.push(now);
  attempts.set(email, recent);
  return false;
}

const ok = () => NextResponse.json({ ok: true });

export async function POST(request: Request) {
  let email = '';
  try {
    const body = (await request.json()) as { email?: unknown };
    email = String(body.email ?? '').trim().toLowerCase();
  } catch {
    return ok();
  }

  if (!EMAIL_RE.test(email) || rateLimited(email)) return ok();

  const link = await generateRecoveryLink(email, safeOrigin(request));
  if (!link) return ok(); // e-mail sem conta no Auth

  const { subject, html } = resetPasswordEmail(link);
  const res = await sendTransactionalEmail({ to: email, subject, html });
  if (!res.ok) console.error('[reset-password] falha ao enviar:', res.error);

  return ok();
}
