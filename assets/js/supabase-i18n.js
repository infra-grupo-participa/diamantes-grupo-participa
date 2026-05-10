/**
 * supabase-i18n.js — Traduz mensagens de erro do Supabase Auth pra PT-BR.
 *
 * Expõe window.GP_I18N.translateAuthError(err) → string em PT-BR.
 * Se não reconhece, devolve fallback genérico (não vaza msg em inglês).
 */
(function () {
  'use strict';

  const MAP = {
    'invalid_credentials':                 'Email ou senha incorretos.',
    'invalid login credentials':           'Email ou senha incorretos.',
    'user_not_found':                      'Usuário não encontrado.',
    'email_not_confirmed':                 'Confirme seu email antes de entrar.',
    'email_address_invalid':               'Email inválido. Use o email completo cadastrado.',
    'over_email_send_rate_limit':          'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    'over_request_rate_limit':             'Muitas requisições. Aguarde um pouco.',
    'signup_disabled':                     'Cadastro disponível somente mediante convite.',
    'weak_password':                       'A senha precisa ter no mínimo 8 caracteres.',
    'same_password':                       'A nova senha precisa ser diferente da atual.',
    'session_not_found':                   'Sessão expirada. Faça login novamente.',
    'no_authorization':                    'Sessão expirada. Faça login novamente.',
    'reauthentication_needed':             'Reautentique-se para concluir esta ação.',
    'user_already_exists':                 'Este email já está cadastrado.',
    'email_exists':                        'Este email já está cadastrado.',
    'unexpected_failure':                  'Erro inesperado. Tente novamente.',
    'validation_failed':                   'Dados inválidos. Verifique os campos.',
    'flow_state_not_found':                'Sessão expirada. Tente novamente.',
    'flow_state_expired':                  'Sessão expirada. Tente novamente.',
    'unauthorized':                        'Sem permissão pra essa ação.',
  };

  function translateAuthError(err) {
    if (!err) return 'Erro desconhecido.';
    // Aceita tanto string quanto objeto Error/Supabase
    const code = (err.code || err.error_code || '').toString().toLowerCase().trim();
    const msg  = (err.message || err.msg || (typeof err === 'string' ? err : '')).toString().trim();

    // 1. Match por código exato
    if (code && MAP[code]) return MAP[code];

    // 2. Match por substring na mensagem
    const msgLower = msg.toLowerCase();
    for (const key of Object.keys(MAP)) {
      if (msgLower.includes(key.replace(/_/g, ' ')) || msgLower.includes(key)) {
        return MAP[key];
      }
    }

    // 3. Match por padrões comuns
    if (/invalid login credentials/i.test(msg)) return MAP['invalid_credentials'];
    if (/email.*invalid/i.test(msg))            return MAP['email_address_invalid'];
    if (/rate limit/i.test(msg))                return MAP['over_request_rate_limit'];
    if (/already (exists|registered)/i.test(msg)) return MAP['user_already_exists'];
    if (/network|fetch|cors/i.test(msg))        return 'Sem conexão com o servidor. Tente novamente.';

    // 4. Fallback genérico (não vaza inglês)
    return 'Não foi possível concluir. Tente novamente em instantes.';
  }

  window.GP_I18N = { translateAuthError };
})();
