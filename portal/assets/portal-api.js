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
      await supabase.auth.signOut();
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

  // ============================================================
  // DEMANDAS (Etapa D)
  // ============================================================

  async function listMyDemands({ status = 'all' } = {}) {
    let q = client()
      .from('v_demands').select('*').order('created_at', { ascending: false });
    if (status && status !== 'all') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function getDemand(id) {
    const { data, error } = await client()
      .from('v_demands').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getDemandMembers(demand_id) {
    const supabase = client();
    const result = [];

    // 1. Clientes via demand_members → portal.users
    const { data: memberRows, error } = await supabase
      .from('demand_members')
      .select('id, user_id, role, approved_finish, approved_at, added_at')
      .eq('demand_id', demand_id)
      .neq('role', 'operator');  // operadores ficam em demand_operators
    if (error) throw error;

    if (memberRows?.length) {
      const ids = memberRows.map(m => m.user_id);
      const { data: users } = await supabase
        .from('users').select('id, name, email, role, position_id, metadata').in('id', ids);
      const usersById = Object.fromEntries((users || []).map(u => [u.id, u]));
      for (const m of memberRows) {
        const u = usersById[m.user_id] || {};
        result.push({ ...m, user_name: u.name, user_email: u.email, user_role: u.role,
          avatar_url: u.metadata?.avatar_url || null, position_name: null, position_color: null });
      }
    }

    // 2. Operadores via demand_operators → portal.operators
    const { data: opRows } = await supabase
      .from('demand_operators')
      .select('id, operator_id, role, added_at')
      .eq('demand_id', demand_id);

    if (opRows?.length) {
      const opIds = opRows.map(r => r.operator_id);
      const { data: ops } = await supabase
        .from('operators').select('id, name, email, position_id, metadata').in('id', opIds);
      const opsById = Object.fromEntries((ops || []).map(o => [o.id, o]));
      const posIds = [...new Set((ops || []).map(o => o.position_id).filter(Boolean))];
      let posById = {};
      if (posIds.length) {
        const { data: positions } = await supabase
          .from('positions').select('id, name, color').in('id', posIds);
        posById = Object.fromEntries((positions || []).map(p => [p.id, p]));
      }
      for (const r of opRows) {
        const o = opsById[r.operator_id] || {};
        const p = posById[o.position_id] || null;
        result.push({
          id: r.id,
          user_id: r.operator_id,  // sintético: operator_id como user_id para compatibilidade de display
          role: 'operator',
          approved_finish: false,
          approved_at: null,
          added_at: r.added_at,
          user_name: o.name,
          user_email: o.email,
          user_role: 'operator',
          avatar_url: o.metadata?.avatar_url || null,
          position_name: p?.name || null,
          position_color: p?.color || null,
        });
      }
    }

    return result;
  }

  async function listOperatorsForClient() {
    const supabase = client();
    const me = await getMe();
    if (!me) throw new Error('Sessão expirada.');
    // Lê operadores via team_assignments.operator_id → portal.operators
    const { data: assignments, error } = await supabase
      .from('team_assignments')
      .select('operator_id')
      .eq('client_slug', me.client_slug)
      .not('operator_id', 'is', null);
    if (error) throw error;
    const opIds = (assignments || []).map(t => t.operator_id).filter(Boolean);
    if (opIds.length === 0) {
      // Sem equipe atribuída — devolve todos os operadores ativos
      const { data: all } = await supabase
        .from('operators')
        .select('id, name, email, position_id, metadata')
        .eq('status', 'active')
        .eq('contract_active', true)
        .order('name');
      return enrichOperators(all || []);
    }
    const { data: ops } = await supabase
      .from('operators')
      .select('id, name, email, position_id, metadata')
      .in('id', opIds);
    return enrichOperators(ops || []);
  }

  async function enrichOperators(users) {
    const supabase = client();
    const pids = [...new Set(users.map(u => u.position_id).filter(Boolean))];
    let positionsById = {};
    if (pids.length) {
      const { data: positions } = await supabase
        .from('positions').select('id, name, color').in('id', pids);
      positionsById = Object.fromEntries((positions || []).map(p => [p.id, p]));
    }
    return users.map(u => ({
      ...u,
      position_name: positionsById[u.position_id]?.name || null,
      position_color: positionsById[u.position_id]?.color || null,
      avatar_url: u.metadata?.avatar_url || null,
    }));
  }

  async function createDemand({ title, description, operator_ids, project_id, starts_at, ends_at }) {
    if (!title || !title.trim()) throw new Error('Título obrigatório.');
    if (!operator_ids || operator_ids.length === 0) throw new Error('Selecione pelo menos um operador.');
    const { data, error } = await client().rpc('create_demand', {
      p_title:       title.trim(),
      p_description: description || null,
      p_operators:   operator_ids,
      p_project_id:  project_id || null,
      p_starts_at:   starts_at || null,
      p_ends_at:     ends_at   || null,
    });
    if (error) throw error;
    return data;
  }

  async function updateDemand(id, patch) {
    const allowed = ['title','description','status','starts_at','ends_at'];
    const clean = {};
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
    clean.updated_at = new Date().toISOString();
    const { data, error } = await client()
      .from('demands').update(clean).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  // Chat/anexos delegam para o núcleo compartilhado (DemandChatAPI)
  function chatApi() {
    if (!window.DemandChatAPI) throw new Error('demand-chat-api.js não carregado.');
    return window.DemandChatAPI;
  }

  async function listDemandMessages(demand_id) {
    return chatApi().listMessages(demand_id);
  }

  async function postDemandMessage(demand_id, content, attachments = []) {
    const me = await getMe();
    if (!me) throw new Error('Sessão expirada.');
    const slug = me.client_slug || getSlugFromUrl() || '';
    return chatApi().postMessageWithClickup(demand_id, content, attachments, me.id, slug);
  }

  function subscribeDemand(demand_id, callbacks) {
    return chatApi().subscribe(demand_id, callbacks || {});
  }

  async function uploadDemandAttachment(demand_id, file) {
    return chatApi().uploadAttachment(demand_id, file);
  }

  async function signDemandAttachment(path, ttlSec) {
    return chatApi().signAttachment(path, ttlSec);
  }

  async function finalizeMyPart(demand_id) {
    const { data, error } = await client().rpc('finalize_my_part', { p_demand_id: demand_id });
    if (error) throw error;
    return data; // { status, approved, total_operators, finalized_at }
  }

  // ============================================================
  // Avaliações (cliente → operador)
  // ============================================================

  // Busca rating pending OU submitted da demanda. Retorna null se não existe.
  async function getMyDemandRating(demand_id) {
    const { data, error } = await client()
      .from('ratings')
      .select('id, score, comment, status, submitted_at')
      .eq('demand_id', demand_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function submitClientRating(demand_id, score, comment) {
    const { data, error } = await client().rpc('submit_client_rating', {
      p_demand_id: demand_id,
      p_score:     score,
      p_comment:   comment || null,
    });
    if (error) throw error;
    return data;
  }

  // ============================================================
  // Briefing Básico (acessos, 1x por cliente, gate)
  // ============================================================
  async function getClientBriefing() {
    const { data, error } = await client().rpc('get_client_briefing');
    if (error) throw error;
    return data || null; // { client_slug, access, base_status, pending_flags, submitted_at, services }
  }

  async function saveBaseBriefing(access, pending) {
    const { data, error } = await client().rpc('save_base_briefing', {
      p_access:  access || {},
      p_pending: pending || null,
    });
    if (error) throw error;
    return data;
  }

  async function submitBaseBriefing() {
    const { data, error } = await client().rpc('submit_base_briefing');
    if (error) throw error;
    return data;
  }

  // Conveniência: o cliente já concluiu o Briefing Básico?
  async function isBaseReady() {
    try {
      const b = await getClientBriefing();
      return !!b && b.base_status === 'submitted';
    } catch (_) { return false; }
  }

  // ============================================================
  // Projetos (evento multi-serviço)
  // ============================================================
  async function listMyProjects() {
    const { data, error } = await client()
      .from('projects')
      .select('id, title, services, briefing, briefing_status, status, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function getProject(id) {
    const { data, error } = await client()
      .from('projects')
      .select('id, title, services, briefing, briefing_status, status, client_slug, created_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function createProject({ title, general, services }) {
    if (!title || !title.trim()) throw new Error('Título obrigatório.');
    const { data, error } = await client().rpc('create_project', {
      p_title:    title.trim(),
      p_general:  general || {},
      p_services: services || [],
    });
    if (error) throw error;
    return data;
  }

  async function saveProjectBriefing(project_id, answers) {
    const { data, error } = await client().rpc('save_project_briefing', {
      p_project_id: project_id,
      p_answers:    answers || {},
    });
    if (error) throw error;
    return data;
  }

  async function submitProjectBriefing(project_id) {
    const { data, error } = await client().rpc('submit_project_briefing', {
      p_project_id: project_id,
    });
    if (error) throw error;
    return data;
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
    // Demandas
    listMyDemands,
    getDemand,
    getDemandMembers,
    listOperatorsForClient,
    createDemand,
    updateDemand,
    listDemandMessages,
    postDemandMessage,
    uploadDemandAttachment,
    signDemandAttachment,
    finalizeMyPart,
    subscribeDemand,
    // Avaliação
    getMyDemandRating,
    submitClientRating,
    // Briefing Básico (gate)
    getClientBriefing,
    saveBaseBriefing,
    submitBaseBriefing,
    isBaseReady,
    // Projetos (evento multi-serviço)
    listMyProjects,
    getProject,
    createProject,
    saveProjectBriefing,
    submitProjectBriefing,
    // Sessão
    logout,
    getSlugFromUrl,
    _client: client,
  };
})();
