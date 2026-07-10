import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { assertAdminApi } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Corrige o e-mail de login de um aluno. Precisa da service-role porque o e-mail de
 * login mora em `auth.users` (mudado via admin API) — atualizar só `portal.users`
 * deixaria o login preso no endereço antigo. Mantém os dois em sincronia.
 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SLUG_RE = /^[a-z0-9-]+$/;

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const guard = await assertAdminApi();
  if (guard instanceof NextResponse) return guard;

  const { slug, email: rawEmail } = (await request.json().catch(() => ({}))) as {
    slug?: string;
    email?: string;
  };
  const email = String(rawEmail ?? '').trim().toLowerCase();
  if (!slug || !SLUG_RE.test(slug)) return fail('Aluno (slug) inválido.', 400);
  if (!EMAIL_RE.test(email)) return fail('E-mail inválido.', 400);

  const admin = createAdminClient();

  // Linha de login do aluno.
  const { data: student } = await admin
    .from('users')
    .select('id, email, auth_user_id')
    .eq('client_slug', slug)
    .eq('role', 'user')
    .not('auth_user_id', 'is', null)
    .maybeSingle();
  if (!student?.auth_user_id) return fail('Este aluno não tem acesso criado.', 404);
  if (student.email === email) return NextResponse.json({ ok: true, email }); // nada a fazer

  // O e-mail já é de outra conta?
  const { data: taken } = await admin
    .from('users')
    .select('id')
    .ilike('email', email)
    .neq('id', student.id)
    .maybeSingle();
  if (taken) return fail('Já existe uma conta com esse e-mail.', 409);

  // Muda no Auth (login) e no perfil, nessa ordem: se o Auth falhar, não dessincroniza.
  const { error: authErr } = await admin.auth.admin.updateUserById(student.auth_user_id, {
    email,
    email_confirm: true,
  });
  if (authErr) {
    if (/already been registered|already exists|email_exists/i.test(authErr.message)) {
      return fail('Já existe um usuário com esse e-mail.', 409);
    }
    return fail('Falha ao alterar o e-mail no login: ' + authErr.message, 502);
  }

  const { error: upErr } = await admin
    .from('users')
    .update({ email, updated_at: new Date().toISOString() })
    .eq('id', student.id);
  if (upErr) return fail('E-mail alterado no login, mas falhou ao atualizar o perfil: ' + upErr.message, 500);

  return NextResponse.json({ ok: true, email });
}
