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

  // Mapeia serviço para o setor responsável (nomes dos positions no Supabase)
  function canonicalServiceName(raw) {
    if (!raw) return 'Desconhecido';
    const up = raw.toUpperCase().trim();
    if (up.includes('TRÁFEGO') || up.includes('TRAFEGO') || up === 'ANÚNCIOS PAGOS' || up === 'ANUNCIOS PAGOS') return 'Gestor de Tráfego';
    if (up.includes('WEB DESIGN') || up === 'WEBDESIGNER' || up === 'WEB DESIGNER' || up === 'HOST' || up.includes('HOSPED')) return 'Web Designer';
    if (up.includes('EDIÇÃO DE VÍDEO') || up.includes('EDICAO DE VIDEO') || up.includes('EDIÇÃO DE VIDEO')) return 'Editor de Vídeo';
    if (up.includes('REDES SOCIAIS') || up === 'SOCIAL MEDIA') return 'Social Media';
    if (up.includes('DISPAROS') || up === 'AUTOMAÇÃO' || up === 'AUTOMACAO') return 'Automação';
    if (up.includes('DESIGN GRÁFICO') || up.includes('DESIGN GRAFICO') || up === 'DESIGNER') return 'Designer';
    if (up.includes('COPYWRITER') || up === 'COPY') return 'Copywriter';
    return raw;
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
      .select('id, service_type, status, metadata, access_until, offer_code, canceled_at, created_at')
      .eq('client_slug', slug)
      .order('service_type', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function getClientActiveServices(slug) {
    const { data, error } = await client().rpc('get_client_active_services', { p_client_slug: slug });
    if (error) throw error;
    return data || [];
  }

  async function getStudentStats() {
    const supabase = client();
    const [total, paid, partial, overdue, withTeam] = await Promise.all([
      supabase.from('v_students').select('slug', { count: 'exact', head: true }),
      supabase.from('v_students').select('slug', { count: 'exact', head: true }).in('billing_status', ['paid', 'current']),
      supabase.from('v_students').select('slug', { count: 'exact', head: true }).eq('billing_status', 'partial'),
      supabase.from('v_students').select('slug', { count: 'exact', head: true }).eq('billing_status', 'overdue'),
      supabase.from('v_students').select('slug', { count: 'exact', head: true }).gt('team_count', 0),
    ]);
    return {
      total:    total.count    || 0,
      active:   paid.count     || 0,
      partial:  partial.count  || 0,
      overdue:  overdue.count  || 0,
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
      .select('id, name, email, position_id, positions(name)')
      .eq('role', 'operator')
      .eq('status', 'approved')
      .eq('contract_active', true)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(o => ({
      ...o,
      position_name: o.positions?.name || null,
    }));
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
    const [paid, overdue, pending, canceled, sumPaid, dueSoon] = await Promise.all([
      supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'paid'),
      supabase.from('subscriptions').select('id', { count: 'exact', head: true }).in('status', ['overdue', 'late']),
      supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'canceled'),
      supabase.from('subscriptions').select('monthly_value').neq('status', 'canceled'),
      supabase.from('v_subscriptions').select('*').gte('next_billing_date', new Date().toISOString().slice(0,10))
        .lte('next_billing_date', new Date(Date.now() + 7*24*60*60*1000).toISOString().slice(0,10))
        .neq('status', 'canceled')
        .order('next_billing_date', { ascending: true }).limit(8),
    ]);

    const mrr = (sumPaid.data || []).reduce((s, r) => s + Number(r.monthly_value || 0), 0);
    const active = (paid.count || 0) + (pending.count || 0) + (overdue.count || 0);
    const retention = active === 0 ? 0 : Math.round(((paid.count || 0) / active) * 100);

    return {
      mrr,
      active,
      paid: paid.count || 0,
      late: overdue.count || 0,
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
    // Prioriza serviços vindos do Hotmart (com offer_code) — usa nome canônico da oferta
    const { data, error } = await client()
      .from('services')
      .select('service_type, status, offer_code, metadata')
      .eq('status', 'active');
    if (error) throw error;

    const counts = {};
    (data || []).forEach(s => {
      counts[canonicalServiceName(s.service_type)] = (counts[canonicalServiceName(s.service_type)] || 0) + 1;
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

  async function exportPurchasesCsv() {
    const { data, error } = await client()
      .schema('portal')
      .from('hotmart_purchases')
      .select('transaction_code, buyer_email, offer_code, service_name, amount, status, payment_type, installments_total, installment_number, charged_at, client_slug')
      .order('charged_at', { ascending: false })
      .limit(2000);
    if (error) throw error;

    const header = [
      'Código Transação', 'Email Comprador', 'Código Oferta', 'Serviço',
      'Valor (R$)', 'Status', 'Tipo Pagamento', 'Total Parcelas', 'Nº Parcela',
      'Data Compra', 'Aluno (slug)', 'Vencimento',
    ];

    const rows = (data || []).map(p => {
      const charged = p.charged_at ? new Date(p.charged_at) : null;
      const accessUntil = charged
        ? new Date(new Date(charged.getFullYear(), charged.getMonth() + 1, 18))
        : null;
      return [
        p.transaction_code,
        p.buyer_email,
        p.offer_code || '',
        canonicalServiceName(p.service_name || ''),
        Number(p.amount || 0).toFixed(2).replace('.', ','),
        p.status,
        p.payment_type || '',
        p.installments_total || 1,
        p.installment_number || 1,
        charged ? charged.toLocaleDateString('pt-BR') : '',
        p.client_slug || '',
        accessUntil ? accessUntil.toLocaleDateString('pt-BR') : '',
      ];
    });

    const csv = [header, ...rows].map(r => r.map(csvEscape).join(';')).join('\n');
    return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  }

  async function listPurchasesHistory({ limit = 50, offset = 0, month = '', clientSlug = '' } = {}) {
    let q = client()
      .schema('portal')
      .from('hotmart_purchases')
      .select('transaction_code, buyer_email, offer_code, service_name, amount, status, payment_type, installments_total, installment_number, charged_at, client_slug', { count: 'exact' })
      .order('charged_at', { ascending: false });
    if (month) {
      // month = 'YYYY-MM' — filtra pelo intervalo exato do mês
      const [y, m] = month.split('-').map(Number);
      const from = new Date(y, m - 1, 1).toISOString();
      const to   = new Date(y, m, 1).toISOString();
      q = q.gte('charged_at', from).lt('charged_at', to);
    }
    if (clientSlug) q = q.eq('client_slug', clientSlug);
    q = q.range(offset, offset + limit - 1);
    const { data, count, error } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
  }

  async function getPurchaseMonthlyStats() {
    const { data, error } = await client()
      .schema('portal')
      .from('hotmart_purchases')
      .select('charged_at, amount, status, payment_type, service_name, client_slug')
      .in('status', ['approved', 'complete']);
    if (error) throw error;
    const byMonth = {};
    (data || []).forEach(p => {
      const m = (p.charged_at || '').slice(0, 7);
      if (!m) return;
      if (!byMonth[m]) byMonth[m] = { month: m, total: 0, count: 0, bySetor: {} };
      byMonth[m].total += Number(p.amount || 0);
      byMonth[m].count++;
      const setor = canonicalServiceName(p.service_name || '');
      byMonth[m].bySetor[setor] = (byMonth[m].bySetor[setor] || 0) + Number(p.amount || 0);
    });
    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  }

  // =============================================================
  // DEMANDAS (Kanban admin — Etapa D3)
  // =============================================================

  async function listAllDemands({ search = '', clientSlug = 'all', status = 'all' } = {}) {
    let q = client()
      .from('v_demands').select('*').order('created_at', { ascending: false });
    if (status && status !== 'all') q = q.eq('status', status);
    if (clientSlug && clientSlug !== 'all') q = q.eq('client_slug', clientSlug);
    if (search && search.trim()) {
      const s = search.trim().replace(/[%_]/g, '');
      q = q.or(`title.ilike.%${s}%,client_name.ilike.%${s}%,description.ilike.%${s}%`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function getDemandFullDetails(demand_id) {
    const supabase = client();
    const [{ data: demand }, { data: members }, { data: messages }] = await Promise.all([
      supabase.from('v_demands').select('*').eq('id', demand_id).maybeSingle(),
      supabase.from('demand_members').select('*').eq('demand_id', demand_id),
      supabase.from('demand_messages').select('*').eq('demand_id', demand_id).order('created_at'),
    ]);
    if (!demand) return null;
    const userIds = [...new Set([...(members||[]).map(m=>m.user_id), ...(messages||[]).map(m=>m.user_id)])];
    let usersById = {};
    if (userIds.length) {
      const { data: users } = await supabase.from('users')
        .select('id, name, email, role, position_id, metadata, clickup_user_id').in('id', userIds);
      usersById = Object.fromEntries((users||[]).map(u => [u.id, u]));
      const pids = [...new Set((users||[]).map(u=>u.position_id).filter(Boolean))];
      if (pids.length) {
        const { data: positions } = await supabase.from('positions').select('id,name,color').in('id', pids);
        const positionsById = Object.fromEntries((positions||[]).map(p => [p.id, p]));
        Object.values(usersById).forEach(u => {
          const p = positionsById[u.position_id];
          if (p) { u._position_name = p.name; u._position_color = p.color; }
        });
      }
    }
    const memb = (members||[]).map(m => {
      const u = usersById[m.user_id] || {};
      return { ...m, user_name: u.name, user_email: u.email,
               position_name: u._position_name, position_color: u._position_color,
               clickup_user_id: u.clickup_user_id || null };
    });
    const msgs = (messages||[]).map(m => {
      const u = usersById[m.user_id] || {};
      return { ...m, author_name: u.name, author_role: u.role, avatar_url: u.metadata?.avatar_url || null };
    });
    return { demand, members: memb, messages: msgs };
  }

  async function adminUpdateDemandStatus(id, status) {
    const valid = ['open','in_progress','review','done','canceled'];
    if (!valid.includes(status)) throw new Error('Status inválido.');
    const patch = { status, updated_at: new Date().toISOString() };
    if (status === 'done') patch.finalized_at = new Date().toISOString();
    const { data, error } = await client()
      .from('demands').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async function adminDemandStats() {
    const supabase = client();
    const [open, prog, review, done, canceled, all] = await Promise.all([
      supabase.from('demands').select('id', { count: 'exact', head: true }).eq('status','open'),
      supabase.from('demands').select('id', { count: 'exact', head: true }).eq('status','in_progress'),
      supabase.from('demands').select('id', { count: 'exact', head: true }).eq('status','review'),
      supabase.from('demands').select('id', { count: 'exact', head: true }).eq('status','done'),
      supabase.from('demands').select('id', { count: 'exact', head: true }).eq('status','canceled'),
      supabase.from('demands').select('id', { count: 'exact', head: true }),
    ]);
    return {
      total: all.count || 0,
      open: open.count || 0,
      in_progress: prog.count || 0,
      review: review.count || 0,
      done: done.count || 0,
      canceled: canceled.count || 0,
    };
  }

  async function listClientsSimple() {
    const { data, error } = await client()
      .from('clients').select('slug, display_name').order('display_name');
    if (error) throw error;
    return data || [];
  }

  // =============================================================
  // GUARD: redireciona se não-admin
  // =============================================================

  // Overlay sutil (tema claro) que só aparece se a verificação demorar mais
  // de 250ms — evita o flash em navegações rápidas com sessão já em cache.
  let __overlayTimer = null;
  function scheduleAuthOverlay() {
    __overlayTimer = setTimeout(() => {
      if (document.getElementById('__authOverlay')) return;
      const ov = document.createElement('div');
      ov.id = '__authOverlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(247,248,250,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;color:#475569;font-family:Inter,sans-serif;font-size:0.9rem;backdrop-filter:blur(2px);';
      ov.innerHTML = '<div style="text-align:center;"><div style="width:28px;height:28px;border:3px solid rgba(15,23,42,0.10);border-top-color:#F29725;border-radius:50%;margin:0 auto 12px;animation:__sp 0.8s linear infinite;"></div>Verificando acesso…</div><style>@keyframes __sp{to{transform:rotate(360deg)}}</style>';
      document.body.appendChild(ov);
    }, 250);
  }
  function cancelAuthOverlay() {
    if (__overlayTimer) { clearTimeout(__overlayTimer); __overlayTimer = null; }
    const ov = document.getElementById('__authOverlay');
    if (ov) ov.remove();
  }

  // Cache em sessionStorage: se já validamos como admin nesta sessão de browser,
  // confiamos por 5 min — evita roundtrip a cada troca de aba.
  const CACHE_KEY = '__gpAdminProfile';
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

  async function requireAdmin() {
    // Caminho rápido: já validamos como admin neste tab há pouco
    const cached = readCachedProfile();
    if (cached && cached.role === 'admin' && cached.status === 'approved') {
      // Revalida no Supabase em background (sem bloquear UI)
      validateInBackground();
      return cached;
    }

    scheduleAuthOverlay();
    const supabase = client();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      clearCachedProfile();
      window.location.replace('/');
      return null;
    }
    const { data: profile, error } = await supabase
      .from('users')
      .select('id, role, status, name, email')
      .eq('auth_user_id', session.user.id)
      .maybeSingle();
    if (error || !profile) {
      clearCachedProfile();
      cancelAuthOverlay();
      window.location.replace('/');
      return null;
    }
    if (profile.role !== 'admin' || profile.status !== 'approved') {
      clearCachedProfile();
      if (profile.role === 'user' && profile.status === 'approved') {
        window.location.replace('/');
      } else {
        await supabase.auth.signOut();
        window.location.replace('/');
      }
      return null;
    }
    cancelAuthOverlay();
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
        .select('id, role, status, name, email')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();
      if (!profile || profile.role !== 'admin' || profile.status !== 'approved') {
        clearCachedProfile();
        window.location.replace('/');
        return;
      }
      writeCachedProfile(profile);
    } catch (_) { /* network blip — ignora, cache continua válido */ }
  }

  async function logout() {
    clearCachedProfile();
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
    getClientActiveServices,
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
    exportPurchasesCsv,
    listPurchasesHistory,
    getPurchaseMonthlyStats,
    // Demandas
    listAllDemands,
    getDemandFullDetails,
    adminUpdateDemandStatus,
    adminDemandStats,
    listClientsSimple,
    // Utils
    canonicalServiceName,
    downloadBlob,
    requireAdmin,
    logout,
    _client: client,
  };
})();
