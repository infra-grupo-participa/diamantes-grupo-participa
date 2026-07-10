import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { assertAdminApi } from '@/lib/auth';
import { generateRecoveryLink } from '@/lib/email/recovery-link';
import { firstAccessEmail } from '@/lib/email/templates';
import { sendTransactionalEmail } from '@/lib/email/send';
import { safeOrigin } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cria o login do aluno (ONB-01) e envia o e-mail de primeiro acesso.
 *
 * Roda no servidor porque a instância tem signup desabilitado (`disable_signup`):
 * `auth.signUp` no browser falha. Aqui usamos `admin.createUser` — sem senha, com o
 * e-mail já confirmado. O aluno define a senha pelo link, mesmo fluxo do "esqueci
 * minha senha".
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SLUG_RE = /^[a-z0-9-]+$/;

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const { slug, email: rawEmail, name } = (await request.json().catch(() => ({}))) as {
    slug?: string;
    email?: string;
    name?: string | null;
  };

  const email = String(rawEmail ?? '').trim().toLowerCase();
  if (!slug || !SLUG_RE.test(slug)) return fail('Aluno (slug) inválido.', 400);
  if (!EMAIL_RE.test(email)) return fail('E-mail inválido.', 400);

  // ── Auth: só admin aprovado ──────────────────────────────────────────────
  const guard = await assertAdminApi();
  if (guard instanceof NextResponse) return guard;

  const admin = createAdminClient();

  // ── O aluno já tem acesso? ───────────────────────────────────────────────
  const { data: existing } = await admin
    .from('users')
    .select('email')
    .eq('client_slug', slug)
    .eq('role', 'user')
    .maybeSingle();
  if (existing) return fail('Este aluno já tem acesso: ' + existing.email, 409);

  // ── Cria no Auth ─────────────────────────────────────────────────────────
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name: name || slug, role: 'user', status: 'approved' },
  });
  if (createErr || !created?.user) {
    const msg = createErr?.message ?? '';
    if (/already been registered|already exists|email_exists/i.test(msg)) {
      return fail('Já existe um usuário com esse e-mail.', 409);
    }
    return fail('Falha ao criar usuário no Auth: ' + msg, 502);
  }
  const authUserId = created.user.id;

  // Um trigger em auth.users já insere a linha em portal.users (status pending,
  // client_slug null) — então promovemos essa linha em vez de inserir outra.
  const { data: promoted, error: upErr } = await admin
    .from('users')
    .update({ email, name: name || slug, role: 'user', status: 'approved', client_slug: slug })
    .eq('auth_user_id', authUserId)
    .select('id');

  if (upErr) return fail('Usuário criado, mas falhou ao vincular o perfil: ' + upErr.message, 500);

  if (!promoted?.length) {
    const { error: insErr } = await admin.from('users').insert({
      auth_user_id: authUserId,
      email,
      name: name || slug,
      role: 'user',
      status: 'approved',
      client_slug: slug,
    });
    if (insErr) return fail('Usuário criado, mas falhou ao vincular o perfil: ' + insErr.message, 500);
  }

  // ── E-mail de primeiro acesso (Resend) ───────────────────────────────────
  let emailSent = false;
  const link = await generateRecoveryLink(email, safeOrigin(request));
  if (link) {
    const { subject, html } = firstAccessEmail(link, name);
    const res = await sendTransactionalEmail({ to: email, subject, html });
    emailSent = res.ok;
    if (!res.ok) console.error('[criar-acesso] falha ao enviar:', res.error);
  }

  // Marca reunião de configuração pendente (best-effort).
  try {
    const { data: prof } = await admin
      .from('client_profiles')
      .select('data')
      .eq('client_slug', slug)
      .maybeSingle();
    const d = ((prof?.data as Record<string, unknown>) || {}) as Record<string, unknown>;
    d.onboarding = { meeting_pending: true, access_created_at: new Date().toISOString() };
    await admin.from('client_profiles').update({ data: d }).eq('client_slug', slug);
  } catch {
    /* perfil pode não existir ainda */
  }

  return NextResponse.json({ ok: true, email, emailSent });
}
