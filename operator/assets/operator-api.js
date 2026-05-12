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
      .select('id, role, status, name, email, metadata, position_id, clickup_user_id, last_login_at, created_at')
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
        .select('id, role, status, name, email, metadata, position_id, clickup_user_id, last_login_at, created_at')
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
      .select('id, role, status, name, email, metadata, position_id, clickup_user_id, last_login_at, created_at')
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

  async function updateMe(patch) {
    const supabase = client();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sessão expirada.');

    const allowed = ['name', 'position_id'];
    const clean = {};
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];

    if (patch.metadata && typeof patch.metadata === 'object') {
      const { data: current } = await supabase.from('users')
        .select('metadata').eq('auth_user_id', session.user.id).maybeSingle();
      clean.metadata = Object.assign({}, current?.metadata || {}, patch.metadata);
    }
    clean.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('users').update(clean)
      .eq('auth_user_id', session.user.id).select().single();
    if (error) throw error;
    clearCached();
    return data;
  }

  async function changePassword(newPassword) {
    if (!newPassword || newPassword.length < 8) {
      throw new Error('A senha precisa ter no mínimo 8 caracteres.');
    }
    const { error } = await client().auth.updateUser({ password: newPassword });
    if (error) throw error;
    return true;
  }

  async function uploadAvatar(file) {
    if (!file) throw new Error('Selecione um arquivo.');
    if (file.size > 2 * 1024 * 1024) throw new Error('Arquivo maior que 2 MB.');
    const supabase = client();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sessão expirada.');
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${session.user.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage.from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) throw upErr;
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    await updateMe({ metadata: { avatar_url: publicUrl } });
    return publicUrl;
  }

  async function listPositions() {
    const { data, error } = await client()
      .from('positions')
      .select('id, slug, name, color, active')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function listMyRatings(limit = 50) {
    const me = await getMe();
    if (!me) throw new Error('Sessão expirada.');
    const supabase = client();
    const { data, error } = await supabase
      .from('ratings')
      .select('id, client_slug, task_id, score, comment, created_at')
      .eq('user_id', me.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    if (!data || data.length === 0) return [];

    const slugs = [...new Set(data.map(r => r.client_slug).filter(Boolean))];
    let clientsBySlug = {};
    if (slugs.length) {
      const { data: clients } = await supabase
        .from('clients').select('slug, display_name').in('slug', slugs);
      clientsBySlug = Object.fromEntries((clients || []).map(c => [c.slug, c]));
    }
    return data.map(r => ({
      ...r,
      client_display_name: clientsBySlug[r.client_slug]?.display_name || r.client_slug,
    }));
  }

  // ============================================================
  // Avaliações (operador → cliente)
  // ============================================================

  async function getMyOperatorRating(demand_id) {
    const me = await getMe();
    if (!me) return null;
    const { data, error } = await client()
      .from('operator_to_client_ratings')
      .select('id, score, comment, dimensions, status, submitted_at')
      .eq('demand_id',   demand_id)
      .eq('operator_id', me.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function submitOperatorRating(demand_id, score, comment, dimensions) {
    const { data, error } = await client().rpc('submit_operator_rating', {
      p_demand_id:  demand_id,
      p_score:      score,
      p_comment:    comment || null,
      p_dimensions: dimensions || {},
    });
    if (error) throw error;
    return data;
  }

  async function logout() {
    clearCached();
    await client().auth.signOut();
    window.location.replace('/');
  }

  window.OperatorAPI = {
    requireOperator,
    getMe,
    updateMe,
    changePassword,
    uploadAvatar,
    listPositions,
    listMyRatings,
    listAssignedDemands,
    getDemand,
    updateDemandStatus,
    getDashboard,
    listMyStudents,
    getMyOperatorRating,
    submitOperatorRating,
    logout,
    _client: client,
  };
})();
