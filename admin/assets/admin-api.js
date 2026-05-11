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
  // FUNCIONÁRIOS (portal.users WHERE role='admin')
  // =============================================================

  async function listEmployees({ search = '', status = 'all', limit = 25, offset = 0 } = {}) {
    let q = client()
      .from('users')
      .select('id, auth_user_id, email, name, role, status, created_at, last_login_at, metadata', { count: 'exact' })
      .eq('role', 'admin')
      .order('created_at', { ascending: true });

    if (status && status !== 'all') {
      q = q.eq('status', status);
    }
    if (search && search.trim()) {
      const s = search.trim().replace(/[%_]/g, ''); // remove curingas
      q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%`);
    }
    q = q.range(offset, offset + limit - 1);

    const { data, count, error } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
  }

  async function createEmployee({ name, email, password }) {
    if (!name || !email || !password) throw new Error('Nome, email e senha são obrigatórios.');
    if (password.length < 8) throw new Error('Senha precisa ter no mínimo 8 caracteres.');

    // 1) Cria em auth.users via signUp (anonKey + RLS valida senão).
    //    Como o admin já está logado, este signUp deslogaria o admin atual,
    //    então usamos uma sessão isolada. Truque: salvar a sessão atual,
    //    chamar signUp (que cria o user), depois restaurar.
    const supabase = client();
    const { data: currentSession } = await supabase.auth.getSession();

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: { name, role: 'admin', status: 'approved' },
      },
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

    // 2) Insere em portal.users (RLS users_admin_insert exige is_admin())
    const { data: row, error: insertError } = await supabase
      .from('users')
      .insert({
        auth_user_id: newUserId,
        email: email.trim().toLowerCase(),
        name,
        role: 'admin',
        status: 'approved',
      })
      .select()
      .single();
    if (insertError) throw insertError;
    return row;
  }

  async function updateEmployee(id, patch) {
    if (!id) throw new Error('id obrigatório');
    const allowed = ['name', 'email', 'status'];
    const clean = {};
    for (const k of allowed) {
      if (patch[k] !== undefined) clean[k] = patch[k];
    }
    if (clean.email) clean.email = String(clean.email).trim().toLowerCase();
    clean.updated_at = new Date().toISOString();
    const { data, error } = await client()
      .from('users')
      .update(clean)
      .eq('id', id)
      .eq('role', 'admin')
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

  async function getEmployeeStats() {
    const supabase = client();
    const [total, active, disabled] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin'),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('status', 'approved'),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('status', 'disabled'),
    ]);
    return {
      total: total.count || 0,
      active: active.count || 0,
      disabled: disabled.count || 0,
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
    const header = ['Nome', 'Email', 'Status', 'Criado em', 'Último login'];
    const rows = data.map(u => [
      u.name,
      u.email,
      u.status,
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
    getEmployeeStats,
    exportEmployeesCsv,
    downloadBlob,
    requireAdmin,
    logout,
    _client: client,
  };
})();
