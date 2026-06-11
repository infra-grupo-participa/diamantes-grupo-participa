// Tradução de erros de auth do Supabase → PT-BR (porta de assets/js/supabase-i18n.js).
// Nunca vaza inglês: tenta código exato → substring → regex → fallback genérico.

const BY_CODE: Record<string, string> = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  invalid_login_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed: 'E-mail ainda não confirmado.',
  user_not_found: 'Usuário não encontrado.',
  weak_password: 'Senha muito fraca. Use ao menos 8 caracteres.',
  same_password: 'A nova senha precisa ser diferente da atual.',
  session_not_found: 'Sua sessão expirou. Entre novamente.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde um instante.',
  over_email_send_rate_limit: 'Muitas tentativas. Aguarde um instante.',
  user_already_exists: 'Este e-mail já está cadastrado.',
  email_exists: 'Este e-mail já está cadastrado.',
  signup_disabled: 'Cadastro desabilitado.',
  validation_failed: 'Dados inválidos. Verifique os campos.',
};

type SupabaseishError = { code?: string; message?: string; status?: number } | null | undefined;

export function translateAuthError(err: SupabaseishError): string {
  if (!err) return 'Não foi possível concluir. Tente novamente.';
  const code = (err.code ?? '').toLowerCase();
  if (code && BY_CODE[code]) return BY_CODE[code];

  const msg = (err.message ?? '').toLowerCase();
  if (!msg) return 'Não foi possível concluir. Tente novamente.';

  for (const key of Object.keys(BY_CODE)) {
    if (msg.includes(key.replace(/_/g, ' '))) return BY_CODE[key];
  }
  if (/invalid login credentials/.test(msg)) return BY_CODE.invalid_credentials;
  if (/email not confirmed/.test(msg)) return BY_CODE.email_not_confirmed;
  if (/email.*invalid|invalid.*email/.test(msg)) return 'E-mail inválido.';
  if (/rate limit|too many/.test(msg)) return BY_CODE.over_request_rate_limit;
  if (/already (registered|exists)/.test(msg)) return BY_CODE.user_already_exists;
  if (/password/.test(msg) && /weak|short|least/.test(msg)) return BY_CODE.weak_password;
  if (/network|fetch|failed to/.test(msg)) return 'Falha de conexão. Verifique sua internet.';
  return 'Não foi possível concluir. Tente novamente.';
}
