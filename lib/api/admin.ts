// lib/api/admin.ts — wrapper sobre supabase-js (browser) para o painel admin.
// Porte fiel de admin/assets/admin-api.js (equipe, funcionários, operadores, projetos).
// Schema 'portal' já vem do createClient(); RLS bloqueia quem não é admin aprovado.

import { createClient } from '@/lib/supabase/client';

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────

export type EmployeeRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: 'admin' | 'operator' | string;
  status: string;
  position_id?: string | null;
  position_name?: string | null;
  position_color?: string | null;
  rating_avg?: number | null;
  students_count?: number | null;
  created_at?: string | null;
  last_login_at?: string | null;
};

export type OperatorRow = {
  id: string;
  name: string | null;
  email: string | null;
  position_id?: string | null;
  position_name?: string | null;
  position_color?: string | null;
  clickup_user_id?: string | null;
  rating_avg?: number | null;
  students_count?: number | null;
  status: string;
  contract_active?: boolean | null;
  created_at?: string | null;
};

export type OperatorPerformance = {
  operator_id: string;
  name: string | null;
  email: string | null;
  position_name: string | null;
  position_color: string | null;
  status: string;
  points_score: number;
  demands_count: number;
  demand_rating_count: number;
  demand_avg: number;
  demand_star_distribution: Record<string, number>;
  project_rating_count: number;
  project_avg: number;
  project_nps_avg: number;
};

/** Performance detalhada de um operador (view v_operator_performance). */
export async function getOperatorPerformance(operatorId: string): Promise<OperatorPerformance | null> {
  const { data, error } = await client()
    .from('v_operator_performance')
    .select('*')
    .eq('operator_id', operatorId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as OperatorPerformance | null;
}

export type Position = {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  sort_order: number | null;
  active: boolean | null;
};

export type EmployeeStats = {
  employees: number;
  admins: number;
  operators: number;
  students: number;
  ratings: number;
  ratingAvg: number;
  activeToday: number;
};

export type ProjectRow = {
  id: string;
  title: string;
  client_slug: string;
  services: string[] | null;
  status: string;
  briefing_status: string | null;
  briefing: ProjectBriefingData | null;
  created_at: string;
  clients?: { display_name?: string | null } | null;
};

export type ProjectBriefingData = {
  general?: Record<string, unknown>;
  services?: Record<string, Record<string, unknown>>;
};

function client() {
  return createClient();
}

// Mapeia serviço para o setor responsável (nomes dos positions no Supabase)
export function canonicalServiceName(raw?: string | null): string {
  if (!raw) return 'Desconhecido';
  const up = raw.toUpperCase().trim();
  if (up.includes('TRÁFEGO') || up.includes('TRAFEGO') || up === 'ANÚNCIOS PAGOS' || up === 'ANUNCIOS PAGOS') return 'Gestor de Tráfego';
  if (up === 'HOST' || up.includes('HOSPED')) return 'Hospedagem';
  if (up.includes('WEB DESIGN') || up === 'WEBDESIGNER' || up === 'WEB DESIGNER') return 'Web Designer';
  if (up.includes('EDIÇÃO DE VÍDEO') || up.includes('EDICAO DE VIDEO') || up.includes('EDIÇÃO DE VIDEO')) return 'Editor de Vídeo';
  if (up.includes('REDES SOCIAIS') || up === 'SOCIAL MEDIA') return 'Social Media';
  if (up.includes('DISPAROS') || up === 'AUTOMAÇÃO' || up === 'AUTOMACAO') return 'Automação';
  if (up.includes('DESIGN GRÁFICO') || up.includes('DESIGN GRAFICO') || up === 'DESIGNER') return 'Designer';
  if (up.includes('COPYWRITER') || up === 'COPY') return 'Copywriter';
  return raw;
}

// ─────────────────────────────────────────────────────────────
// Posições (cargos)
// ─────────────────────────────────────────────────────────────

export async function listPositions(): Promise<Position[]> {
  const { data, error } = await client()
    .from('positions')
    .select('id, slug, name, color, sort_order, active')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Position[];
}

// ─────────────────────────────────────────────────────────────
// Funcionários (admins + operators via view v_employees)
// ─────────────────────────────────────────────────────────────

export async function listEmployees({
  search = '',
  status = 'all',
  role = 'all',
  limit = 25,
  offset = 0,
}: {
  search?: string;
  status?: string;
  role?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: EmployeeRow[]; count: number }> {
  let q = client()
    .from('v_employees')
    .select('*', { count: 'exact' })
    .order('role', { ascending: false }) // admin antes
    .order('name', { ascending: true });

  if (status && status !== 'all') q = q.eq('status', status);
  if (role && role !== 'all') q = q.eq('role', role);
  if (search && search.trim()) {
    const s = search.trim().replace(/[%_]/g, '');
    q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%`);
  }
  q = q.range(offset, offset + limit - 1);

  const { data, count, error } = await q;
  if (error) throw error;
  return { data: (data ?? []) as EmployeeRow[], count: count ?? 0 };
}

export async function createEmployee({
  name,
  email,
  password,
  role = 'admin',
  position_id = null,
}: {
  name: string;
  email: string;
  password: string;
  role?: 'admin' | 'operator';
  position_id?: string | null;
}): Promise<EmployeeRow> {
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

  // Restaura sessão do admin (signUp troca a sessão ativa)
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
      name,
      role,
      status: 'approved',
      position_id: role === 'operator' ? position_id : null,
    })
    .select()
    .single();
  if (insertError) throw insertError;
  return row as EmployeeRow;
}

export async function updateEmployee(
  id: string,
  patch: Partial<{ name: string; email: string; status: string; role: string; position_id: string | null }>,
): Promise<EmployeeRow> {
  if (!id) throw new Error('id obrigatório');
  const allowed = ['name', 'email', 'status', 'role', 'position_id'] as const;
  const clean: Record<string, unknown> = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) clean[k] = patch[k];
  }
  if (clean.email) clean.email = String(clean.email).trim().toLowerCase();
  if (clean.role && !['admin', 'operator'].includes(clean.role as string)) throw new Error('role inválido.');
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
  return data as EmployeeRow;
}

export async function setEmployeeStatus(id: string, status: string): Promise<EmployeeRow> {
  if (!['approved', 'disabled', 'rejected'].includes(status)) throw new Error('status inválido');
  return updateEmployee(id, { status });
}

export async function disableEmployee(id: string) {
  return setEmployeeStatus(id, 'disabled');
}
export async function enableEmployee(id: string) {
  return setEmployeeStatus(id, 'approved');
}

export async function deleteEmployee(id: string): Promise<true> {
  if (!id) throw new Error('id obrigatório');
  const { error } = await client().rpc('delete_employee', { target_id: id });
  if (error) throw error;
  return true;
}

export async function getEmployeeStats(): Promise<EmployeeStats> {
  const supabase = client();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const [admins, operators, students, ratingsCount, ratingsScores, activeToday] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin'),
    supabase.from('operators').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('clients').select('slug', { count: 'exact', head: true }),
    supabase.from('ratings').select('id', { count: 'exact', head: true }),
    supabase.from('ratings').select('score'),
    supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .gte('last_login_at', todayIso),
  ]);

  for (const r of [admins, operators, students, ratingsCount, ratingsScores, activeToday]) {
    if (r.error) throw r.error;
  }

  let avg = 0;
  const scores = (ratingsScores.data ?? []) as Array<{ score: number | null }>;
  if (scores.length) {
    const sum = scores.reduce((s, r) => s + (Number(r.score) || 0), 0);
    avg = sum / scores.length; // escala já é 1-5 (migration 038)
  }

  return {
    employees: (admins.count ?? 0) + (operators.count ?? 0),
    admins: admins.count ?? 0,
    operators: operators.count ?? 0,
    students: students.count ?? 0,
    ratings: ratingsCount.count ?? 0,
    ratingAvg: Number(avg.toFixed(2)) || 0,
    activeToday: activeToday.count ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Equipe operacional (portal.operators)
// ─────────────────────────────────────────────────────────────

export async function listOperatorsAdmin({
  search = '',
  status = 'all',
  limit = 25,
  offset = 0,
}: {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: OperatorRow[]; count: number }> {
  let q = client()
    .from('v_operators')
    .select('*', { count: 'exact' })
    .order('name', { ascending: true });
  if (status && status !== 'all') q = q.eq('status', status);
  if (search && search.trim()) {
    const s = search.trim().replace(/[%_]/g, '');
    q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%`);
  }
  q = q.range(offset, offset + limit - 1);
  const { data, count, error } = await q;
  if (error) throw error;
  return { data: (data ?? []) as OperatorRow[], count: count ?? 0 };
}

export async function createOperator({
  name,
  email = null,
  position_id = null,
  clickup_user_id = null,
}: {
  name: string;
  email?: string | null;
  position_id?: string | null;
  clickup_user_id?: string | null;
}): Promise<OperatorRow> {
  if (!name) throw new Error('Nome é obrigatório.');
  const { data, error } = await client()
    .from('operators')
    .insert({ name, email: email || null, position_id: position_id || null, clickup_user_id: clickup_user_id || null })
    .select()
    .single();
  if (error) throw error;
  return data as OperatorRow;
}

export async function updateOperator(
  id: string,
  patch: Partial<{
    name: string;
    email: string | null;
    position_id: string | null;
    clickup_user_id: string | null;
    contract_active: boolean;
    status: string;
    metadata: unknown;
  }>,
): Promise<OperatorRow> {
  if (!id) throw new Error('id obrigatório');
  const allowed = ['name', 'email', 'position_id', 'clickup_user_id', 'contract_active', 'status', 'metadata'] as const;
  const clean: Record<string, unknown> = {};
  for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
  if (clean.email) clean.email = String(clean.email).trim().toLowerCase() || null;
  clean.updated_at = new Date().toISOString();
  const { data, error } = await client().from('operators').update(clean).eq('id', id).select().single();
  if (error) throw error;
  return data as OperatorRow;
}

export async function setOperatorStatus(id: string, status: string): Promise<OperatorRow> {
  if (!['active', 'inactive', 'suspended'].includes(status)) throw new Error('status inválido');
  return updateOperator(id, { status });
}

export async function deleteOperator(id: string): Promise<true> {
  if (!id) throw new Error('id obrigatório');
  const { error } = await client().from('operators').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ─────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function exportEmployeesCsv(): Promise<Blob> {
  const { data } = await listEmployees({ limit: 1000, offset: 0, role: 'admin' });
  const header = ['Nome', 'Email', 'Função', 'Cargo', 'Status', 'Avaliação geral', 'Alunos atendidos', 'Criado em', 'Último login'];
  const rows = data.map((u) => [
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
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(';')).join('\n');
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
}

export async function exportOperatorsCsv(): Promise<Blob> {
  const { data } = await listOperatorsAdmin({ limit: 1000, offset: 0 });
  const header = ['Nome', 'Email', 'Cargo', 'ClickUp ID', 'Avaliação', 'Alunos', 'Status', 'Criado em'];
  const rows = data.map((o) => [
    o.name,
    o.email || '',
    o.position_name || '',
    o.clickup_user_id || '',
    o.rating_avg ?? '0.00',
    o.students_count ?? 0,
    o.status,
    o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : '',
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(';')).join('\n');
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────
// Projetos / Briefings (query direta projects + clients)
// ─────────────────────────────────────────────────────────────

export async function listProjects({
  service = '',
  status = '',
  briefing = '',
}: {
  service?: string;
  status?: string;
  briefing?: string;
} = {}): Promise<ProjectRow[]> {
  let q = client()
    .from('projects')
    .select('*, clients(display_name)')
    .order('created_at', { ascending: false });

  if (service) q = q.contains('services', [service]);
  if (status) q = q.eq('status', status);
  if (briefing) q = q.eq('briefing_status', briefing);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ProjectRow[];
}

// Conclui um projeto (status → completed). O banco dispara o convite de
// avaliação do cliente (migration 036). Só admin (RLS/RPC bloqueia o resto).
export async function completeProject(id: string): Promise<true> {
  const { error } = await client().rpc('complete_project', { p_project_id: id });
  if (error) throw error;
  return true;
}

// Acessos herdados do Briefing Básico do cliente (read-only) para um slug.
export async function getClientBriefingAccess(slug: string): Promise<Record<string, Record<string, unknown>>> {
  try {
    const { data } = await client()
      .from('client_briefing')
      .select('access')
      .eq('client_slug', slug)
      .maybeSingle();
    return ((data?.access as Record<string, Record<string, unknown>>) ?? {}) as Record<string, Record<string, unknown>>;
  } catch {
    return {};
  }
}
