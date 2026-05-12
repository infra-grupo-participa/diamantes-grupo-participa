/**
 * operator-api.js — wrapper sobre supabase-js para a área do operador.
 *
 * Espelho mínimo do PortalAPI, focado no domínio do operador:
 *   - requireOperator()       → garante sessão de operador aprovado
 *   - getMe()                 → portal.users do logado
 *   - listAssignedDemands({status})  → v_my_assigned_demands com filtro
 *   - getDemand(id)           → busca uma demanda específica
 *   - updateDemandStatus(id, status) → muda status (sync ClickUp via trigger)
 *   - logout()
 *
 * Chat/anexos são delegados para window.DemandChatAPI (módulo compartilhado).
 * RLS protege tudo no servidor: operador só enxerga demandas em
 * portal.demand_members com role='operator'.
 */
(function () {
  'use strict';

  const OPERATOR_STATUSES = ['open', 'in_progress', 'review', 'done', 'canceled'];

  function client() {
    return window.getSupabaseClient();
  }

  let __overlayTimer = null;
  function scheduleOverlay() {
    __overlayTimer = setTimeout(() => {
      if (document.getElementById('__opOverlay')) return;
      const ov = document.createElement('div');
      ov.id = '__opOverlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(246,248,252,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;color:#4b5468;font-family:Inter,sans-serif;font-size:0.9rem;backdrop-filter:blur(2px);';
      ov.innerHTML = '<div style="text-align:center;"><div style="width:28px;height:28px;border:3px solid rgba(20,24,42,0.10);border-top-color:#F29725;border-radius:50%;margin:0 auto 12px;animation:__opSp 0.8s linear infinite;"></div>Carregando…</div><style>@keyframes __opSp{to{transform:rotate(360deg)}}</style>';
      document.body.appendChild(ov);
    }, 250);
  }
  function cancelOverlay() {
    if (__overlayTimer) { clearTimeout(__overlayTimer); __overlayTimer = null; }
    const ov = document.getElementById('__opOverlay');
    if (ov) ov.remove();
  }

  const CACHE_KEY = '__gpOperatorProfile';
  const CACHE_TTL_MS = 5 * 60 * 1000;
  function readCached() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj?.at || Date.now() - obj.at > CACHE_TTL_MS) return null;
      return obj.profile;
    } catch { return null; }
  }
  function writeCached(profile) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), profile })); } catch (_) {}
  }
  function clearCached() {
    try { sessionStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  async function requireOperator() {
    const cached = readCached();
    if (cached && cached.role === 'operator' && cached.status === 'approved') {
      validateInBackground();
      return cached;
    }

    scheduleOverlay();
    const supabase = client();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      clearCached();
      cancelOverlay();
      window.location.replace('/');
      return null;
    }
    const { data: profile, error } = await supabase
      .from('users')
      .select('id, role, status, name, email, metadata, position_id, clickup_user_id, last_login_at')
      .eq('auth_user_id', session.user.id)
      .maybeSingle();
    if (error || !profile) {
      clearCached();
      cancelOverlay();
      window.location.replace('/');
      return null;
    }
    if (profile.role === 'admin' && profile.status === 'approved') {
      cancelOverlay();
      window.location.replace('/admin/');
      return null;
    }
    if (profile.role !== 'operator' || profile.status !== 'approved') {
      await supabase.auth.signOut();
      clearCached();
      cancelOverlay();
      window.location.replace('/');
      return null;
    }
    cancelOverlay();
    writeCached(profile);
    return profile;
  }

  async function validateInBackground() {
    try {
      const supabase = client();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        clearCached();
        window.location.replace('/');
        return;
      }
      const { data: profile } = await supabase
        .from('users')
        .select('id, role, status, name, email, metadata, position_id, clickup_user_id, last_login_at')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();
      if (!profile || profile.role !== 'operator' || profile.status !== 'approved') {
        clearCached();
        window.location.replace('/');
        return;
      }
      writeCached(profile);
    } catch (_) { /* network blip */ }
  }

  async function getMe() {
    const cached = readCached();
    if (cached) return cached;
    const supabase = client();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data } = await supabase
      .from('users')
      .select('id, role, status, name, email, metadata, position_id, clickup_user_id, last_login_at')
      .eq('auth_user_id', session.user.id)
      .maybeSingle();
    if (data) writeCached(data);
    return data;
  }

  async function listAssignedDemands(opts = {}) {
    const { status = 'all' } = opts;
    let q = client()
      .from('v_my_assigned_demands')
      .select('*')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at',      { ascending: false });
    if (status && status !== 'all') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function getDemand(id) {
    const { data, error } = await client()
      .from('v_my_assigned_demands').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function updateDemandStatus(id, status) {
    if (!OPERATOR_STATUSES.includes(status)) {
      throw new Error('Status inválido: ' + status);
    }
    const { data, error } = await client()
      .from('demands')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, status, updated_at').single();
    if (error) throw error;
    return data;
  }

  async function getDashboard() {
    const { data, error } = await client().rpc('get_operator_dashboard');
    if (error) throw error;
    return data || {};
  }

  async function listMyStudents() {
    const { data, error } = await client()
      .from('v_my_students')
      .select('*')
      .order('display_name', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function logout() {
    clearCached();
    await client().auth.signOut();
    window.location.replace('/');
  }

  window.OperatorAPI = {
    requireOperator,
    getMe,
    listAssignedDemands,
    getDemand,
    updateDemandStatus,
    getDashboard,
    listMyStudents,
    logout,
    _client: client,
  };
})();
