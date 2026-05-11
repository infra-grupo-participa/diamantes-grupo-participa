/**
 * admin-api.js — wrapper sobre supabase-js para o painel admin.
 *
 * Expõe window.AdminAPI com:
 *   - listEmployees({ search, status, limit, offset })
 *   - createEmployee({ name, email, password })
 *   - updateEmployee(id, patch)
 *   - disableEmployee(id) / enableEmployee(id)
 *   - exportEmployeesCsv()
 *   - listStudents({ ... }) / getStudentDetail(slug) ... (etapa 2)
 *   - listSubscriptions({ ... }) ... (etapa 3)
 *
 * Tudo via supabase-js direto, schema 'portal'. RLS já bloqueia
 * leitura/escrita para quem não for admin aprovado.
 */
(function () {
  'use strict';

  function client() {
    return window.getSupabaseClient();
  }

  // =============================================================
  // POSIÇÕES (cargos)
  // =============================================================

  async function listPositions() {
    const { data, error } = await client()
      .from('positions')
      .select('id, slug, name, color, sort_order, active')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  // =============================================================
  // FUNCIONÁRIOS (admins + operators via view v_employees)
  // =============================================================

  async function listEmployees({ search = '', status = 'all', role = 'all', limit = 25, offset = 0 } = {}) {
    let q = client()
      .from('v_employees')
      .select('*', { count: 'exact' })
      .order('role', { ascending: false }) // admin antes
      .order('name', { ascending: true });

    if (status && status !== 'all') q = q.eq('status', status);
    if (role && role !== 'all')     q = q.eq('role', role);
    if (search && search.trim()) {
      const s = search.trim().replace(/[%_]/g, '');
      q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%`);
    }
    q = q.range(offset, offset + limit - 1);

    const { data, count, error } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
  }

  async function createEmployee({ name, email, password, role = 'admin', position_id = null }) {
    if (!name || !email || !password) throw new Error('Nome, email e senha são obrigatórios.');
    if (password.length < 8) throw new Error('Senha precisa ter no mínimo 8 caracteres.');
    if (!['admin', 'operator'].includes(role)) throw new Error('role inválido.');
    if (role === 'operator' && !position_id) throw new Error('Operador precisa de cargo.');

    const supabase = client();
    const { data: currentSession } = await supabase.auth.getSession();

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { name, role, status: 'approved' } },
    });
    if (signUpError) throw new Error(signUpError.message);
    if (!signUpData?.user) throw new Error('Falha ao criar usuário no Auth.');

    const newUserId = signUpData.user.id;

    // Restaura sessão do admin
    if (currentSession?.session) {
      await supabase.auth.setSession({
        access_token: currentSession.session.access_token,
        refresh_token: currentSession.session.refresh_token,
      });
    }

    const { data: row, error: insertError } = await supabase
      .from('users')
      .insert({
        auth_user_id: newUserId,
        email: email.trim().toLowerCase(),
        name, role,
        status: 'approved',
        position_id: role === 'operator' ? position_id : null,
      })
      .select()
      .single();
    if (insertError) throw insertError;
    return row;
  }

  async function updateEmployee(id, patch) {
    if (!id) throw new Error('id obrigatório');
    const allowed = ['name', 'email', 'status', 'role', 'position_id'];
    const clean = {};
    for (const k of allowed) {
      if (patch[k] !== undefined) clean[k] = patch[k];
    }
    if (clean.email) clean.email = String(clean.email).trim().toLowerCase();
    if (clean.role && !['admin', 'operator'].includes(clean.role)) throw new Error('role inválido.');
    if (clean.role === 'admin') clean.position_id = null;
    clean.updated_at = new Date().toISOString();
    const { data, error } = await client()
      .from('users')
      .update(clean)
      .eq('id', id)
      .in('role', ['admin', 'operator']) // só permite update de funcionários
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function setEmployeeStatus(id, status) {
    if (!['approved', 'disabled', 'rejected'].includes(status)) throw new Error('status inválido');
    return updateEmployee(id, { status });
  }

  async function disableEmployee(id) { return setEmployeeStatus(id, 'disabled'); }
  async function enableEmployee(id)  { return setEmployeeStatus(id, 'approved'); }

  async function deleteEmployee(id) {
    if (!id) throw new Error('id obrigatório');
    const { error } = await client().rpc('delete_employee', { target_id: id });
    if (error) throw error;
    return true;
  }

  async function getEmployeeStats() {
    const supabase = client();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const [employees, students, ratingsCount, ratingsScores, activeToday] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }).in('role', ['admin', 'operator']),
      supabase.from('clients').select('slug', { count: 'exact', head: true }),
      supabase.from('ratings').select('id', { count: 'exact', head: true }),
      supabase.from('ratings').select('score'),
      supabase.from('users').select('id', { count: 'exact', head: true })
        .in('role', ['admin', 'operator']).gte('last_login_at', todayIso),
    ]);

    let avg = 0;
    if (ratingsScores.data && ratingsScores.data.length) {
      const sum = ratingsScores.data.reduce((s, r) => s + (Number(r.score) || 0), 0);
      avg = (sum / ratingsScores.data.length) / 2.0; // 1-10 → 0-5
    }

    return {
      employees:   employees.count || 0,
      students:    students.count  || 0,
      ratings:     ratingsCount.count || 0,
      ratingAvg:   Number(avg.toFixed(2)) || 0,
      activeToday: activeToday.count || 0,
    };
  }

  function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  async function exportEmployeesCsv() {
    const { data } = await listEmployees({ limit: 1000, offset: 0 });
    const header = ['Nome', 'Email', 'Função', 'Cargo', 'Status', 'Avaliação geral', 'Alunos atendidos', 'Criado em', 'Último login'];
    const rows = data.map(u => [
      u.name,
      u.email,
      u.role === 'admin' ? 'Admin' : 'Operador',
      u.position_name || '',
      u.status,
      u.rating_avg ?? '0.00',
      u.students_count ?? 0,
      u.created_at ? new Date(u.created_at).toLocaleString('pt-BR') : '',
      u.last_login_at ? new Date(u.last_login_at).toLocaleString('pt-BR') : '',
    ]);
    const csv = [header, ...rows].map(r => r.map(csvEscape).join(';')).join('\n');
    return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // =============================================================
  // ALUNOS DIAMANTES (portal.clients + v_students + team_assignments + services)
  // =============================================================

  async function listStudents({ search = '', billingStatus = 'all', limit = 25, offset = 0 } = {}) {
    let q = client()
      .from('v_students')
      .select('*', { count: 'exact' })
      .order('name', { ascending: true });

    if (billingStatus && billingStatus !== 'all') {
      q = q.eq('billing_status', billingStatus);
    }
    if (search && search.trim()) {
      const s = search.trim().replace(/[%_]/g, '');
      q = q.or(`name.ilike.%${s}%,slug.ilike.%${s}%,owner_email.ilike.%${s}%`);
    }
    q = q.range(offset, offset + limit - 1);

    const { data, count, error } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
  }

  async function getStudent(slug) {
    if (!slug) throw new Error('slug obrigatório');
    const { data, error } = await client()
      .from('v_students').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getStudentTeam(slug) {
    if (!slug) throw new Error('slug obrigatório');
    const { data, error } = await client().rpc('get_student_team', { p_slug: slug });
    if (error) throw error;
    return data || [];
  }

  async function getStudentServices(slug) {
    const { data, error } = await client()
      .from('services')
      .select('id, service_type, status, metadata, created_at')
      .eq('client_slug', slug)
      .order('service_type', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function getStudentStats() {
    const supabase = client();
    const [total, active, paused, withTeam] = await Promise.all([
      supabase.from('v_students').select('slug', { count: 'exact', head: true }),
      supabase.from('v_students').select('slug', { count: 'exact', head: true }).eq('billing_status', 'current'),
      supabase.from('v_students').select('slug', { count: 'exact', head: true }).neq('billing_status', 'current'),
      supabase.from('v_students').select('slug', { count: 'exact', head: true }).gt('team_count', 0),
    ]);
    return {
      total:    total.count    || 0,
      active:   active.count   || 0,
      paused:   paused.count   || 0,
      withTeam: withTeam.count || 0,
    };
  }

  async function createStudent({ slug, display_name, primary_color = '#F29725' }) {
    if (!slug || !display_name) throw new Error('slug e nome são obrigatórios.');
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('slug deve conter só letras minúsculas, números e hífen.');
    const supabase = client();
    const { data, error } = await supabase
      .from('clients')
      .insert({ slug, display_name, cliente_name_var: display_name, primary_color })
      .select().single();
    if (error) throw error;
    // Cria o profile vazio em paralelo (best-effort)
    await supabase.from('client_profiles').insert({ client_slug: slug, data: { billingStatus: 'current' } });
    return data;
  }

  async function updateStudent(slug, patch) {
    if (!slug) throw new Error('slug obrigatório');
    const allowed = ['display_name', 'primary_color'];
    const clean = {};
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
    clean.updated_at = new Date().toISOString();
    const { data, error } = await client()
      .from('clients').update(clean).eq('slug', slug).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteStudent(slug) {
    if (!slug) throw new Error('slug obrigatório');
    // Deleta o cliente — team_assignments e services caem em cascata via FK
    const { error } = await client().from('clients').delete().eq('slug', slug);
    if (error) throw error;
    return true;
  }

  // =============================================================
  // EQUIPE (team_assignments)
  // =============================================================

  async function assignTeamMember({ client_slug, user_id, position_id, notes = '' }) {
    if (!client_slug || !user_id || !position_id) throw new Error('client_slug, user_id e position_id são obrigatórios.');
    const supabase = client();
    const { data: profile } = await supabase.from('users')
      .select('id').eq('auth_user_id', (await supabase.auth.getSession()).data.session?.user.id).maybeSingle();
    const { data, error } = await supabase.from('team_assignments').insert({
      client_slug, user_id, position_id, notes, assigned_by: profile?.id || null,
    }).select().single();
    if (error) throw error;
    return data;
  }

  async function removeTeamMember(assignment_id) {
    if (!assignment_id) throw new Error('assignment_id obrigatório');
    const { error } = await client().from('team_assignments').delete().eq('id', assignment_id);
    if (error) throw error;
    return true;
  }

  // Listar operadores disponíveis pra atribuir como equipe (para o dropdown)
  async function listOperators() {
    const { data, error } = await client()
      .from('users')
      .select('id, name, email, position_id')
      .eq('role', 'operator')
      .eq('status', 'approved')
      .order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function exportStudentsCsv() {
    const { data } = await listStudents({ limit: 1000, offset: 0 });
    const header = ['Slug', 'Nome', 'Email do dono', 'Status', 'Início contrato', 'Avaliação média', 'Avaliações', 'Serviços', 'Equipe'];
    const rows = data.map(s => [
      s.slug, s.name, s.owner_email || '',
      s.billing_status || '',
      s.contract_started_at || '',
      s.rating_avg ?? '0.00',
      s.ratings_count ?? 0,
      s.services_count ?? 0,
      s.team_count ?? 0,
    ]);
    const csv = [header, ...rows].map(r => r.map(csvEscape).join(';')).join('\n');
    return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  }

  // =============================================================
  // ASSINATURAS (portal.subscriptions + view v_subscriptions)
  // =============================================================

  async function listSubscriptions({ search = '', status = 'all', limit = 25, offset = 0 } = {}) {
    let q = client()
      .from('v_subscriptions')
      .select('*', { count: 'exact' })
      .order('client_name', { ascending: true });

    if (status && status !== 'all') q = q.eq('status', status);
    if (search && search.trim()) {
      const s = search.trim().replace(/[%_]/g, '');
      q = q.or(`client_name.ilike.%${s}%,client_slug.ilike.%${s}%,owner_email.ilike.%${s}%,plan_name.ilike.%${s}%`);
    }
    q = q.range(offset, offset + limit - 1);

    const { data, count, error } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
  }

  async function getSubscriptionStats() {
    const supabase = client();
    const [paid, late, pending, canceled, sumPaid, dueSoon] = await Promise.all([
      supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'paid'),
      supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'late'),
      supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'canceled'),
      supabase.from('subscriptions').select('monthly_value').neq('status', 'canceled'),
      supabase.from('v_subscriptions').select('*').gte('next_billing_date', new Date().toISOString().slice(0,10))
        .lte('next_billing_date', new Date(Date.now() + 7*24*60*60*1000).toISOString().slice(0,10))
        .neq('status', 'canceled')
        .order('next_billing_date', { ascending: true }).limit(8),
    ]);

    const mrr = (sumPaid.data || []).reduce((s, r) => s + Number(r.monthly_value || 0), 0);
    const active = (paid.count || 0) + (pending.count || 0) + (late.count || 0);
    const retention = active === 0 ? 0 : Math.round(((paid.count || 0) / active) * 100);

    return {
      mrr,
      active,
      paid: paid.count || 0,
      late: late.count || 0,
      pending: pending.count || 0,
      canceled: canceled.count || 0,
      retention,
      dueSoon: dueSoon.data || [],
    };
  }

  async function getMrrSparkline() {
    // Histórico simples: usa created_at de cada subscription para inferir crescimento por mês (últimos 6 meses)
    const { data } = await client()
      .from('subscriptions').select('monthly_value, started_at, created_at, status');
    if (!data) return [];
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const sum = data
        .filter(s => s.status !== 'canceled')
        .filter(s => {
          const ref = s.started_at ? new Date(s.started_at) : new Date(s.created_at);
          return ref < next;
        })
        .reduce((s, r) => s + Number(r.monthly_value || 0), 0);
      months.push({
        label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        value: sum,
      });
    }
    return months;
  }

  async function getServicesByType() {
    // Contagem de serviços ativos agrupados por tipo (para o card lateral)
    const { data, error } = await client()
      .from('services').select('service_type, status').eq('status', 'active');
    if (error) throw error;
    const counts = {};
    (data || []).forEach(s => {
      counts[s.service_type] = (counts[s.service_type] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }

  async function createSubscription(payload) {
    const required = ['client_slug', 'plan_name', 'monthly_value'];
    for (const k of required) if (payload[k] === undefined || payload[k] === '') throw new Error(`${k} obrigatório.`);
    const { data, error } = await client().from('subscriptions').insert({
      client_slug:          payload.client_slug,
      plan_name:            payload.plan_name,
      monthly_value:        Number(payload.monthly_value) || 0,
      next_billing_date:    payload.next_billing_date || null,
      payment_method:       payload.payment_method || 'pix',
      payment_method_label: payload.payment_method_label || null,
      status:               payload.status || 'paid',
      started_at:           payload.started_at || null,
      notes:                payload.notes || null,
    }).select().single();
    if (error) throw error;
    return data;
  }

  async function updateSubscription(id, patch) {
    if (!id) throw new Error('id obrigatório');
    const allowed = ['plan_name', 'monthly_value', 'next_billing_date', 'payment_method', 'payment_method_label', 'status', 'started_at', 'notes'];
    const clean = {};
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
    if (clean.monthly_value !== undefined) clean.monthly_value = Number(clean.monthly_value) || 0;
    clean.updated_at = new Date().toISOString();
    const { data, error } = await client().from('subscriptions').update(clean).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async function deleteSubscription(id) {
    if (!id) throw new Error('id obrigatório');
    const { error } = await client().from('subscriptions').delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  async function listClientsForSubscription() {
    // Clientes que ainda não têm subscription
    const supabase = client();
    const [clients, subs] = await Promise.all([
      supabase.from('clients').select('slug, display_name').order('display_name'),
      supabase.from('subscriptions').select('client_slug'),
    ]);
    const has = new Set((subs.data || []).map(s => s.client_slug));
    return (clients.data || []).filter(c => !has.has(c.slug));
  }

  async function exportSubscriptionsCsv() {
    const { data } = await listSubscriptions({ limit: 1000, offset: 0 });
    const header = ['Aluno', 'Email', 'Plano', 'Valor mensal', 'Próxima cobrança', 'Forma de pagamento', 'Status', 'Início'];
    const rows = data.map(s => [
      s.client_name, s.owner_email || '',
      s.plan_name, Number(s.monthly_value).toFixed(2).replace('.', ','),
      s.next_billing_date || '',
      s.payment_method_label || s.payment_method || '',
      s.status,
      s.started_at || '',
    ]);
    const csv = [header, ...rows].map(r => r.map(csvEscape).join(';')).join('\n');
    return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  }

  // =============================================================
  // GUARD: redireciona se não-admin
  // =============================================================

  function showAuthOverlay() {
    if (document.getElementById('__authOverlay')) return;
    const ov = document.createElement('div');
    ov.id = '__authOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:#0f172a;z-index:9999;display:flex;align-items:center;justify-content:center;color:#fff;font-family:Inter,sans-serif;font-size:0.9rem;';
    ov.innerHTML = '<div style="text-align:center;"><div style="width:32px;height:32px;border:3px solid rgba(255,255,255,0.18);border-top-color:#F29725;border-radius:50%;margin:0 auto 14px;animation:spin 0.8s linear infinite;"></div>Verificando acesso…</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(ov);
  }
  function hideAuthOverlay() {
    const ov = document.getElementById('__authOverlay');
    if (ov) ov.remove();
  }

  async function requireAdmin() {
    showAuthOverlay();
    const supabase = client();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.replace('/');
      return null;
    }
    const { data: profile, error } = await supabase
      .from('users')
      .select('id, role, status, name, email')
      .eq('auth_user_id', session.user.id)
      .maybeSingle();
    if (error || !profile) {
      window.location.replace('/');
      return null;
    }
    if (profile.role !== 'admin' || profile.status !== 'approved') {
      // Cliente ou operador autenticado: manda pro lugar certo
      if (profile.role === 'user' && profile.status === 'approved') {
        window.location.replace('/');
      } else {
        await supabase.auth.signOut();
        window.location.replace('/');
      }
      return null;
    }
    hideAuthOverlay();
    return profile;
  }

  async function logout() {
    await client().auth.signOut();
    window.location.replace('/');
  }

  // =============================================================
  // Exports
  // =============================================================

  window.AdminAPI = {
    // Funcionários
    listEmployees,
    createEmployee,
    updateEmployee,
    setEmployeeStatus,
    disableEmployee,
    enableEmployee,
    deleteEmployee,
    getEmployeeStats,
    exportEmployeesCsv,
    listPositions,
    // Alunos Diamantes
    listStudents,
    getStudent,
    getStudentTeam,
    getStudentServices,
    getStudentStats,
    createStudent,
    updateStudent,
    deleteStudent,
    exportStudentsCsv,
    // Equipe
    assignTeamMember,
    removeTeamMember,
    listOperators,
    // Assinaturas
    listSubscriptions,
    getSubscriptionStats,
    getMrrSparkline,
    getServicesByType,
    createSubscription,
    updateSubscription,
    deleteSubscription,
    listClientsForSubscription,
    exportSubscriptionsCsv,
    // Utils
    downloadBlob,
    requireAdmin,
    logout,
    _client: client,
  };
})();
