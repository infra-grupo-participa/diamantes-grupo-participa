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
  // GUARD: redireciona se não-admin
  // =============================================================

  async function requireAdmin() {
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
    if (error || !profile || profile.role !== 'admin' || profile.status !== 'approved') {
      window.location.replace('/');
      return null;
    }
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
    downloadBlob,
    requireAdmin,
    logout,
    _client: client,
  };
})();
