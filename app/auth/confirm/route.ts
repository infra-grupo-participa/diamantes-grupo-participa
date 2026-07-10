import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeOrigin } from '@/lib/site-url';

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
  const { searchParams } = new URL(request.url);
  // Atrás do proxy da Hostinger, request.url traz o bind interno (0.0.0.0:3000) —
  // redirecionar para ele levaria o usuário a um endereço inacessível.
  const origin = safeOrigin(request);
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
