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
  // Supabase pode sinalizar erro direto na URL (link expirado/usado, sem code).
  const authError = searchParams.get('error') || searchParams.get('error_code');
  // `next` só é aceito se for um caminho interno (evita open-redirect).
  const nextParam = searchParams.get('next') ?? '/';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

  if (code && !authError) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Link inválido/expirado → volta ao fluxo de redefinição com aviso.
  return NextResponse.redirect(`${origin}/reset-password?erro=link`);
}
