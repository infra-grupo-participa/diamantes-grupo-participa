/**
 * portal-auth-v2.js — Auth helpers usando Supabase Auth.
 *
 * Substitui portal-auth.js legado (que falava com /api/auth.php).
 * Agora usa supabase.auth.signInWithPassword direto.
 *
 * API pública (window.PortalAuth):
 *   - init() — restaura sessão do localStorage
 *   - login(identifier, password) — { ok, user, redirect, error }
 *   - logout() — destrói sessão
 *   - getSessionUser() — { id, email, role, status, clientSlug, name } | null
 *   - onAuthChange(cb) — listener
 *   - getClientUrl(slug) — '/portal/?slug=X'
 *   - toAppUrl(path) — URL absoluta dentro do app
 *   - clearSession() — alias logout
 */
(function () {
  const APP_BASE = (function () {
    const script = document.currentScript || document.querySelector('script[src*="portal-auth"]');
    const url = script ? new URL(script.src) : window.location;
    return new URL('./', url.href.replace(/assets\/js\/.*$/, '')).href;
  })();

  function toAppUrl(path) {
    return new URL((path || '').replace(/^\.?\/?/, ''), APP_BASE).href;
  }

  function getClientUrl(slug) {
    if (!slug) return toAppUrl('index.html');
    return toAppUrl('portal/?slug=' + encodeURIComponent(slug));
  }

  // Cache do user formatado
  let cachedUser = null;
  function formatUser(authUser, clientSlug) {
    if (!authUser) return null;
    const meta = authUser.user_metadata || {};
    return {
      id: authUser.id,
      email: authUser.email,
      name: meta.name || authUser.email,
      role: meta.role || 'client',
      status: meta.status || 'approved',
      clientSlug: clientSlug ?? meta.clientSlug ?? '',
      isProvisioned: !!meta.isProvisioned,
      legacyId: meta.legacy_id || null,
    };
  }

  async function fetchProfileSlug(supabase, authUid) {
    try {
      const { data } = await supabase.from('users').select('client_slug, role, status, name').eq('auth_user_id', authUid).maybeSingle();
      if (data) return data;
    } catch (_) { /* ignore */ }
    return null;
  }

  let listeners = [];
  function emit(state) {
    cachedUser = state;
    listeners.forEach((l) => { try { l(state); } catch (_) {} });
  }

  async function init() {
    const supabase = window.getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { emit(null); return null; }
    // Tenta buscar slug/role/status real do portal.users; se RLS bloquear (auth_user_id não linkado), usa user_metadata
    const profile = await fetchProfileSlug(supabase, session.user.id);
    const user = formatUser(session.user, profile?.client_slug);
    if (profile) {
      user.role = profile.role || user.role;
      user.status = profile.status || user.status;
      if (profile.name) user.name = profile.name;
    }
    emit(user);
    return user;
  }

  async function login(identifier, password) {
    const supabase = window.getSupabaseClient();
    const email = String(identifier || '').trim().toLowerCase();
    const emailToUse = email === 'admin' ? 'admin@diamantes.local' : email;
    const { data, error } = await supabase.auth.signInWithPassword({ email: emailToUse, password });
    if (error || !data?.user) {
      return { ok: false, error: (error?.message || 'Credenciais inválidas') };
    }
    const profile = await fetchProfileSlug(supabase, data.user.id);
    const user = formatUser(data.user, profile?.client_slug);
    if (profile) {
      user.role = profile.role || user.role;
      user.status = profile.status || user.status;
      if (profile.name) user.name = profile.name;
    }
    emit(user);
    if (user.status === 'pending') {
      return { ok: false, error: 'Sua conta ainda está em aprovação.' };
    }
    if (user.status === 'rejected' || user.status === 'disabled') {
      return { ok: false, error: 'Acesso bloqueado. Fale com o administrador.' };
    }
    const redirect = user.role === 'admin' ? toAppUrl('admin/app.html') : getClientUrl(user.clientSlug);
    return { ok: true, user, redirect };
  }

  async function logout() {
    const supabase = window.getSupabaseClient();
    await supabase.auth.signOut();
    emit(null);
  }

  function getSessionUser() {
    return cachedUser;
  }

  function onAuthChange(cb) {
    listeners.push(cb);
    return () => { listeners = listeners.filter((l) => l !== cb); };
  }

  // API pública
  window.PortalAuth = {
    init,
    login,
    logout,
    clearSession: logout,
    getSessionUser,
    onAuthChange,
    getClientUrl,
    toAppUrl,
    appBase: APP_BASE,
  };

  // Wire onAuthStateChange — desacoplado via setTimeout pra não chamar
  // métodos do supabase de DENTRO do callback (causava deadlock no lock
  // do gotrue quando o lock nativo estava ativo; mantido pro caso de
  // re-introdução do lock).
  if (window.getSupabaseClient) {
    try {
      const supabase = window.getSupabaseClient();
      supabase.auth.onAuthStateChange((event, session) => {
        if (!session?.user) { emit(null); return; }
        // Emit imediato com dados do auth.user (sem profile) pra UI reagir
        emit(formatUser(session.user, undefined));
        // Profile fetch desacoplado
        setTimeout(async () => {
          try {
            const profile = await fetchProfileSlug(supabase, session.user.id);
            if (!profile) return;
            const user = formatUser(session.user, profile.client_slug);
            user.role = profile.role || user.role;
            user.status = profile.status || user.status;
            emit(user);
          } catch (_) { /* ignore */ }
        }, 0);
      });
    } catch (_) { /* supabase ainda não carregou — init() vai cuidar */ }
  }
})();
