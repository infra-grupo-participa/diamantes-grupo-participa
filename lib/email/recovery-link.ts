import { createAdminClient } from '@/lib/supabase/server';

/**
 * Gera o link de definição/redefinição de senha do usuário.
 *
 * Usa `admin.generateLink`, que devolve o `hashed_token` SEM disparar e-mail — quem
 * envia é a EF send-email (Resend). O link aponta para /auth/confirm, e não para
 * /auth/callback: generateLink produz um token de verificação (verifyOtp), não um
 * `code` de PKCE, que é o que o callback sabe trocar por sessão.
 *
 * Devolve null quando o e-mail não existe no Auth — o chamador deve tratar isso
 * silenciosamente para não permitir enumeração de contas.
 */
export async function generateRecoveryLink(
  email: string,
  origin: string,
  next = '/reset-password/update',
): Promise<string | null> {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  if (error) return null;

  const hashedToken = data?.properties?.hashed_token;
  if (!hashedToken) return null;

  const url = new URL('/auth/confirm', origin);
  url.searchParams.set('token_hash', hashedToken);
  url.searchParams.set('type', 'recovery');
  url.searchParams.set('next', next);
  return url.toString();
}
