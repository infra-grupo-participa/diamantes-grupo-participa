import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Callback de autenticação (PKCE) — troca o `code` do link por uma sessão.
 * Usado pelos links de recuperação de senha (resetPasswordForEmail) e,
 * futuramente, confirmação de e-mail. Depois redireciona para `next`.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Link inválido/expirado → volta ao fluxo de redefinição com aviso.
  return NextResponse.redirect(`${origin}/reset-password?erro=link`);
}
