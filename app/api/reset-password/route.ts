import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Redefinição de senha SIMPLES (MVP) — SEM verificação por e-mail.
 * ⚠️ Qualquer pessoa que saiba o e-mail consegue trocar a senha. Aceitável só p/ MVP.
 * Trocar por fluxo com token/e-mail (resetPasswordForEmail) antes de produção real.
 */
export async function POST(req: Request) {
  try {
    const { email, password } = (await req.json()) as { email?: string; password?: string };
    const mail = String(email ?? '').trim().toLowerCase();
    const pass = String(password ?? '');

    if (!mail || !pass) {
      return NextResponse.json({ ok: false, error: 'Informe e-mail e nova senha.' }, { status: 400 });
    }
    if (pass.length < 8) {
      return NextResponse.json({ ok: false, error: 'A senha precisa ter ao menos 8 caracteres.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: user } = await admin
      .from('users')
      .select('auth_user_id')
      .eq('email', mail)
      .maybeSingle();

    if (!user?.auth_user_id) {
      return NextResponse.json({ ok: false, error: 'E-mail não encontrado.' }, { status: 404 });
    }

    const { error } = await admin.auth.admin.updateUserById(user.auth_user_id, { password: pass });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'Não foi possível redefinir a senha.' }, { status: 500 });
  }
}
