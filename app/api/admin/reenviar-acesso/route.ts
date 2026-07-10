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
 * Reenvia ao aluno o link de definição de senha (mesmo do primeiro acesso), pelo
 * Resend. Útil quando o link expirou ou o aluno não recebeu. Não revela detalhes
 * do e-mail além do endereço já cadastrado.
 */
const SLUG_RE = /^[a-z0-9-]+$/;

export async function POST(request: Request) {
  const guard = await assertAdminApi();
  if (guard instanceof NextResponse) return guard;

  const { slug } = (await request.json().catch(() => ({}))) as { slug?: string };
  if (!slug || !SLUG_RE.test(slug)) {
    return NextResponse.json({ ok: false, error: 'Aluno (slug) inválido.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: student } = await admin
    .from('users')
    .select('email, name, auth_user_id')
    .eq('client_slug', slug)
    .eq('role', 'user')
    .not('auth_user_id', 'is', null)
    .maybeSingle();
  if (!student?.email) {
    return NextResponse.json({ ok: false, error: 'Este aluno não tem acesso criado.' }, { status: 404 });
  }

  const link = await generateRecoveryLink(student.email, safeOrigin(request));
  if (!link) {
    return NextResponse.json({ ok: false, error: 'Não foi possível gerar o link.' }, { status: 502 });
  }

  const { subject, html } = firstAccessEmail(link, student.name);
  const res = await sendTransactionalEmail({ to: student.email, subject, html });
  if (!res.ok) console.error('[reenviar-acesso] falha ao enviar:', res.error);

  return NextResponse.json({ ok: true, email: student.email, emailSent: res.ok });
}
