/**
 * portal-api.js — wrapper sobre supabase-js para o portal do cliente.
 *
 * Expõe window.PortalAPI com:
 *   - requireClient(expectedSlug?)  → garante sessão de cliente válido
 *   - getDashboard()                → dados consolidados pra dashboard
 *   - getMe()                       → portal.users do logado
 *   - updateMe(patch)               → CRUD self-update (Etapa B)
 *   - getPreferences() / setPreferences(patch)  (Etapa B)
 *   - logout()
 *
 * Toda chamada vai por supabase-js direto, schema 'portal'. RLS protege.
 */
(function () {
  'use strict';

  function client() {
    return window.getSupabaseClient();
  }

  // ============================================================
  // Overlay sutil de loading (mesma estética do admin)
  // ============================================================
  let __overlayTimer = null;
  function scheduleOverlay() {
    __overlayTimer = setTimeout(() => {
      if (document.getElementById('__authOverlay')) return;
      const ov = document.createElement('div');
      ov.id = '__authOverlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(253,250,245,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;color:#5b524a;font-family:Inter,sans-serif;font-size:0.9rem;backdrop-filter:blur(2px);';
      ov.innerHTML = '<div style="text-align:center;"><div style="width:28px;height:28px;border:3px solid rgba(26,20,16,0.10);border-top-color:#F29725;border-radius:50%;margin:0 auto 12px;animation:__sp 0.8s linear infinite;"></div>Carregando…</div><style>@keyframes __sp{to{transform:rotate(360deg)}}</style>';
      document.body.appendChild(ov);
    }, 250);
  }
  function cancelOverlay() {
    if (__overlayTimer) { clearTimeout(__overlayTimer); __overlayTimer = null; }
    const ov = document.getElementById('__authOverlay');
    if (ov) ov.remove();
  }

  // ============================================================
  // Cache em sessionStorage por 5 min
  // ============================================================
  const CACHE_KEY = '__gpPortalProfile';
  const CACHE_TTL_MS = 5 * 60 * 1000;
  function readCachedProfile() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj?.at || Date.now() - obj.at > CACHE_TTL_MS) return null;
      return obj.profile;
    } catch { return null; }
  }
  function writeCachedProfile(profile) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), profile })); } catch (_) {}
  }
  function clearCachedProfile() {
    try { sessionStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  function getSlugFromUrl() {
    const q = new URLSearchParams(window.location.search).get('slug');
    if (q) return q.trim().toLowerCase();
    // Fallback: extrai de /{slug}/ caso o usuário tenha digitado direto
    const m = window.location.pathname.match(/^\/([a-z][a-z0-9-]+)\/?$/);
    return m ? m[1] : null;
  }

  // ============================================================
  // requireClient — garante que o usuário logado é cliente do slug
  // ============================================================
  async function requireClient(opts = {}) {
    const expectedSlug = opts.expectedSlug || getSlugFromUrl();

    // Cache rápido
    const cached = readCachedProfile();
    if (cached && cached.role === 'user' && cached.status === 'approved') {
      if (expectedSlug && cached.client_slug && cached.client_slug !== expectedSlug) {
        // Slug da URL difere do slug do usuário → manda pro próprio
        window.location.replace('/' + cached.client_slug + '/');
        return null;
      }
      validateInBackground();
      return cached;
    }

    scheduleOverlay();
    const supabase = client();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      clearCachedProfile();
      cancelOverlay();
      window.location.replace('/');
      return null;
    }
    const { data: profile, error } = await supabase
      .from('users')
      .select('id, role, status, name, email, client_slug, metadata')
      .eq('auth_user_id', session.user.id)
      .maybeSingle();
    if (error || !profile) {
      clearCachedProfile();
      cancelOverlay();
      window.location.replace('/');
      return null;
    }
    if (profile.role === 'admin' && profile.status === 'approved') {
      // Admin entrou no portal cliente — manda pro admin
      cancelOverlay();
      window.location.replace('/admin/');
      return null;
    }
    if (profile.role !== 'user' || profile.status !== 'approved') {
      await supabase.auth.signOut();
      clearCachedProfile();
      cancelOverlay();
      window.location.replace('/');
      return null;
    }
    if (expectedSlug && profile.client_slug && profile.client_slug !== expectedSlug) {
      cancelOverlay();
      window.location.replace('/' + profile.client_slug + '/');
      return null;
    }
    if (!profile.client_slug) {
      // Cliente sem slug vinculado — não tem portal pra ele ainda
      await supabase.auth.signOut();
      clearCachedProfile();
      cancelOverlay();
      window.location.replace('/');
      return null;
    }
    cancelOverlay();
    writeCachedProfile(profile);
    return profile;
  }

  async function validateInBackground() {
    try {
      const supabase = client();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        clearCachedProfile();
        window.location.replace('/');
        return;
      }
      const { data: profile } = await supabase
        .from('users')
        .select('id, role, status, name, email, client_slug, metadata')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();
      if (!profile || profile.role !== 'user' || profile.status !== 'approved') {
        clearCachedProfile();
        window.location.replace('/');
        return;
      }
      writeCachedProfile(profile);
    } catch (_) { /* network blip — cache continua valendo */ }
  }

  // ============================================================
  // Dashboard
  // ============================================================
  async function getDashboard() {
    const { data, error } = await client().rpc('get_my_dashboard');
    if (error) throw error;
    return data || null;
  }

  // ============================================================
  // Me / update
  // ============================================================
  async function getMe() {
    const supabase = client();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, client_slug, metadata, created_at, last_login_at')
      .eq('auth_user_id', session.user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function updateMe(patch) {
    const supabase = client();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sessão expirada.');

    const allowed = ['name'];
    const clean = {};
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];

    // Mescla metadata (bio, phone, role-laboral, empresa, cidade)
    if (patch.metadata && typeof patch.metadata === 'object') {
      const { data: current } = await supabase.from('users')
        .select('metadata').eq('auth_user_id', session.user.id).maybeSingle();
      clean.metadata = Object.assign({}, current?.metadata || {}, patch.metadata);
    }
    clean.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('users').update(clean)
      .eq('auth_user_id', session.user.id).select().single();
    if (error) throw error;
    clearCachedProfile();
    return data;
  }

  // ============================================================
  // Preferências
  // ============================================================
  const DEFAULT_PREFS = {
    notify_messages: true,
    notify_demand_update: true,
    notify_deadlines: true,
    notify_weekly_digest: false,
    notify_news: false,
    language: 'pt-BR',
    timezone: 'America/Sao_Paulo',
    theme: 'light',
  };

  async function getPreferences() {
    const me = await getMe();
    if (!me) throw new Error('Sessão expirada.');
    const { data, error } = await client()
      .from('user_preferences').select('*').eq('user_id', me.id).maybeSingle();
    if (error) throw error;
    return data || { user_id: me.id, ...DEFAULT_PREFS };
  }

  async function setPreferences(patch) {
    const me = await getMe();
    if (!me) throw new Error('Sessão expirada.');
    const allowed = Object.keys(DEFAULT_PREFS);
    const clean = { user_id: me.id, updated_at: new Date().toISOString() };
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
    const { data, error } = await client()
      .from('user_preferences').upsert(clean, { onConflict: 'user_id' }).select().single();
    if (error) throw error;
    return data;
  }

  // ============================================================
  // Senha
  // ============================================================
  async function changePassword(newPassword) {
    if (!newPassword || newPassword.length < 8) {
      throw new Error('A senha precisa ter no mínimo 8 caracteres.');
    }
    const { error } = await client().auth.updateUser({ password: newPassword });
    if (error) throw error;
    return true;
  }

  // ============================================================
  // Avatar (Storage)
  // ============================================================
  async function uploadAvatar(file) {
    if (!file) throw new Error('Selecione um arquivo.');
    if (file.size > 2 * 1024 * 1024) throw new Error('Arquivo maior que 2 MB.');
    const supabase = client();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sessão expirada.');
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${session.user.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) throw upErr;
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    // Salva referência no metadata do user
    await updateMe({ metadata: { avatar_url: publicUrl } });
    return publicUrl;
  }

  async function removeAvatar() {
    const supabase = client();
    const me = await getMe();
    if (!me) throw new Error('Sessão expirada.');
    const currentUrl = me.metadata?.avatar_url;
    if (currentUrl) {
      // tenta extrair o path e apagar do bucket
      const m = currentUrl.match(/\/avatars\/(.+)$/);
      if (m) await supabase.storage.from('avatars').remove([m[1]]).catch(() => {});
    }
    await updateMe({ metadata: { avatar_url: null } });
  }

  async function logout() {
    clearCachedProfile();
    await client().auth.signOut();
    window.location.replace('/');
  }

  // ============================================================
  // Exports
  // ============================================================
  window.PortalAPI = {
    requireClient,
    getDashboard,
    getMe,
    updateMe,
    getPreferences,
    setPreferences,
    changePassword,
    uploadAvatar,
    removeAvatar,
    logout,
    getSlugFromUrl,
    _client: client,
  };
})();
