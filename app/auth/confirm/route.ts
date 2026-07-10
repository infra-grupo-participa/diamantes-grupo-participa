import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Confirma o token dos links gerados por `admin.generateLink` (redefinição de senha e
 * primeiro acesso) e abre a sessão de recuperação.
 *
 * Difere de /auth/callback, que trata o `code` do fluxo PKCE (resetPasswordForEmail
 * disparado do browser). Ambos continuam válidos.
 */
const ALLOWED_TYPES: EmailOtpType[] = ['recovery', 'invite', 'email'];

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  // `next` só é aceito como caminho interno (evita open-redirect).
  const nextParam = searchParams.get('next') ?? '/';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/reset-password?erro=link`);
}
