'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * admin-alunos.ts — camada de dados de Alunos Diamantes.
 * Espelha admin/assets/admin-api.js (seção ALUNOS DIAMANTES + EQUIPE) fielmente,
 * via supabase-js no schema portal (RLS protege; só admin aprovado lê/escreve).
 */

// ── Tipos ──────────────────────────────────────────────────────────────
export type StudentRow = {
  slug: string;
  name: string | null;
  display_name?: string | null;
  owner_email: string | null;
  billing_status: string | null;
  contract_started_at?: string | null;
  rating_avg?: number | string | null;
  ratings_count?: number | null;
  services_count?: number | null;
  team_count?: number | null;
  primary_color?: string | null;
};

export type TeamMember = {
  assignment_id: string;
  user_id?: string;
  operator_id?: string;
  user_name: string;
  position_id?: string | null;
  position_name: string;
  position_color?: string | null;
  rating_avg?: number | string | null;
  rating_count?: number | string | null;
};

export type ServiceRow = {
  id: string;
  service_type: string;
  status: string;
  metadata?: Record<string, unknown> | null;
  access_until?: string | null;
  offer_code?: string | null;
  canceled_at?: string | null;
  created_at?: string | null;
};

export type ContractedPosition = { position_id: string; position_name?: string };

export type OperatorOption = {
  id: string;
  name: string;
  email?: string | null;
  position_id: string | null;
  position_name: string | null;
};

export type StudentStats = {
  total: number;
  active: number;
  partial: number;
  overdue: number;
  withTeam: number;
};

// ── Mapa serviço → setor (canonicalServiceName do legado) ────────────────
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

// ── Listagem / detalhe ───────────────────────────────────────────────────
export async function listStudents({
  search = '',
  billingStatus = 'all',
  limit = 25,
  offset = 0,
}: { search?: string; billingStatus?: string; limit?: number; offset?: number } = {}): Promise<{
  data: StudentRow[];
  count: number;
}> {
  const supabase = createClient();
  let q = supabase.from('v_students').select('*', { count: 'exact' }).order('name', { ascending: true });

  if (billingStatus && billingStatus !== 'all') q = q.eq('billing_status', billingStatus);
  if (search && search.trim()) {
    const s = search.trim().replace(/[%_]/g, '');
    q = q.or(`name.ilike.%${s}%,slug.ilike.%${s}%,owner_email.ilike.%${s}%`);
  }
  q = q.range(offset, offset + limit - 1);

  const { data, count, error } = await q;
  if (error) throw error;
  return { data: (data ?? []) as StudentRow[], count: count ?? 0 };
}

export async function getStudent(slug: string): Promise<StudentRow | null> {
  if (!slug) throw new Error('slug obrigatório');
  const supabase = createClient();
  const { data, error } = await supabase.from('v_students').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return (data ?? null) as StudentRow | null;
}

export async function getStudentTeam(slug: string): Promise<TeamMember[]> {
  if (!slug) throw new Error('slug obrigatório');
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_student_team', { p_slug: slug });
  if (error) throw error;
  return (data ?? []) as TeamMember[];
}

export async function getStudentContractedPositions(slug: string): Promise<ContractedPosition[]> {
  if (!slug) throw new Error('slug obrigatório');
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_student_contracted_positions', { p_slug: slug });
  if (error) throw error;
  return (data ?? []) as ContractedPosition[];
}

export async function getStudentServices(slug: string): Promise<ServiceRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('services')
    .select('id, service_type, status, metadata, access_until, offer_code, canceled_at, created_at')
    .eq('client_slug', slug)
    .order('service_type', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ServiceRow[];
}

export async function getStudentStats(): Promise<StudentStats> {
  const supabase = createClient();
  const [total, paid, partial, overdue, withTeam] = await Promise.all([
    supabase.from('v_students').select('slug', { count: 'exact', head: true }),
    supabase.from('v_students').select('slug', { count: 'exact', head: true }).in('billing_status', ['paid', 'current']),
    supabase.from('v_students').select('slug', { count: 'exact', head: true }).eq('billing_status', 'partial'),
    supabase.from('v_students').select('slug', { count: 'exact', head: true }).eq('billing_status', 'overdue'),
    supabase.from('v_students').select('slug', { count: 'exact', head: true }).gt('team_count', 0),
  ]);
  return {
    total: total.count ?? 0,
    active: paid.count ?? 0,
    partial: partial.count ?? 0,
    overdue: overdue.count ?? 0,
    withTeam: withTeam.count ?? 0,
  };
}

// ── CRUD aluno ─────────────────────────────────────────────────────────
export async function createStudent({
  slug,
  display_name,
  primary_color = '#F29725',
}: { slug: string; display_name: string; primary_color?: string }) {
  if (!slug || !display_name) throw new Error('slug e nome são obrigatórios.');
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('slug deve conter só letras minúsculas, números e hífen.');
  const supabase = createClient();
  const { data, error } = await supabase
    .from('clients')
    .insert({ slug, display_name, cliente_name_var: display_name, primary_color })
    .select()
    .single();
  if (error) throw error;
  await supabase.from('client_profiles').insert({ client_slug: slug, data: { billingStatus: 'current' } });
  return data;
}

export async function updateStudent(
  slug: string,
  patch: { display_name?: string; primary_color?: string },
) {
  if (!slug) throw new Error('slug obrigatório');
  const allowed: Array<'display_name' | 'primary_color'> = ['display_name', 'primary_color'];
  const clean: Record<string, unknown> = {};
  for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
  clean.updated_at = new Date().toISOString();
  const supabase = createClient();
  const { data, error } = await supabase.from('clients').update(clean).eq('slug', slug).select().single();
  if (error) throw error;
  return data;
}

export async function deleteStudent(slug: string) {
  if (!slug) throw new Error('slug obrigatório');
  const supabase = createClient();
  const { error } = await supabase.from('clients').delete().eq('slug', slug);
  if (error) throw error;
  return true;
}

// ── ONB-01: gerar acesso (login) do aluno ────────────────────────────────
function genPassword(len = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$%';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}

export async function createClientAccess({
  slug,
  email,
  name,
}: { slug: string; email: string; name?: string | null }): Promise<{ email: string; password: string }> {
  if (!slug || !email) throw new Error('Aluno (slug) e e-mail são obrigatórios.');
  const supabase = createClient();
  email = email.trim().toLowerCase();

  const { data: existing } = await supabase
    .from('users')
    .select('id, email')
    .eq('client_slug', slug)
    .eq('role', 'user')
    .maybeSingle();
  if (existing) throw new Error('Este aluno já tem acesso: ' + existing.email);

  const password = genPassword(12);
  const { data: cur } = await supabase.auth.getSession();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name: name || slug, role: 'user', status: 'approved' } },
  });
  if (signUpError) throw new Error(signUpError.message);
  if (!signUpData?.user) throw new Error('Falha ao criar usuário no Auth.');
  const newUserId = signUpData.user.id;

  // signUp troca a sessão ativa — restaura a do admin
  if (cur?.session) {
    await supabase.auth.setSession({
      access_token: cur.session.access_token,
      refresh_token: cur.session.refresh_token,
    });
  }

  const { error: insErr } = await supabase.from('users').insert({
    auth_user_id: newUserId,
    email,
    name: name || slug,
    role: 'user',
    status: 'approved',
    client_slug: slug,
  });
  if (insErr) throw insErr;

  // Marca reunião de configuração pendente (best-effort)
  try {
    const { data: prof } = await supabase
      .from('client_profiles')
      .select('data')
      .eq('client_slug', slug)
      .maybeSingle();
    const d = ((prof && (prof.data as Record<string, unknown>)) || {}) as Record<string, unknown>;
    d.onboarding = { meeting_pending: true, access_created_at: new Date().toISOString() };
    await supabase.from('client_profiles').update({ data: d }).eq('client_slug', slug);
  } catch {
    /* perfil pode não existir ainda */
  }

  return { email, password };
}

// ── Equipe operacional / assignments ─────────────────────────────────────
export async function listOperators(): Promise<OperatorOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('operators')
    .select('id, name, email, position_id, positions(name)')
    .eq('contract_active', true)
    .eq('status', 'active')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((o: Record<string, unknown>) => ({
    id: o.id as string,
    name: o.name as string,
    email: (o.email as string) ?? null,
    position_id: (o.position_id as string) ?? null,
    position_name:
      (o.positions as { name?: string } | { name?: string }[] | null)
        ? Array.isArray(o.positions)
          ? (o.positions as { name?: string }[])[0]?.name ?? null
          : (o.positions as { name?: string }).name ?? null
        : null,
  }));
}

export async function assignTeamMember({
  client_slug,
  operator_id,
  position_id = null,
  notes = '',
}: { client_slug: string; operator_id: string; position_id?: string | null; notes?: string }) {
  if (!client_slug || !operator_id) throw new Error('client_slug e operator_id são obrigatórios.');
  const supabase = createClient();

  if (!position_id) {
    const { data: op, error: opErr } = await supabase
      .from('operators')
      .select('position_id')
      .eq('id', operator_id)
      .maybeSingle();
    if (opErr) throw opErr;
    position_id = (op?.position_id as string) ?? null;
    if (!position_id)
      throw new Error(
        'Operador sem setor definido. Atribua um cargo na aba Equipe Operacional antes de vinculá-lo a um cliente.',
      );
  }

  const sess = (await supabase.auth.getSession()).data.session;
  const { data: profile } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', sess?.user.id)
    .maybeSingle();

  const { data, error } = await supabase
    .from('team_assignments')
    .insert({ client_slug, operator_id, position_id, notes, assigned_by: profile?.id ?? null })
    .select()
    .single();

  if (error) {
    if (error.code === '23505' && /unique_client_position/i.test(error.message || '')) {
      throw new Error('Este setor já tem um operador atribuído a esse aluno. Remova o atual antes de adicionar outro.');
    }
    throw error;
  }
  return data;
}

export async function removeTeamMember(assignment_id: string) {
  if (!assignment_id) throw new Error('assignment_id obrigatório');
  const supabase = createClient();
  const { error } = await supabase.from('team_assignments').delete().eq('id', assignment_id);
  if (error) throw error;
  return true;
}

// ── Export CSV ───────────────────────────────────────────────────────────
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
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

export async function exportStudentsCsv(): Promise<Blob> {
  const { data } = await listStudents({ limit: 1000, offset: 0 });
  const header = ['Slug', 'Nome', 'Email do dono', 'Status', 'Início contrato', 'Avaliação média', 'Avaliações', 'Serviços', 'Equipe'];
  const rows = data.map((s) => [
    s.slug,
    s.name,
    s.owner_email || '',
    s.billing_status || '',
    s.contract_started_at || '',
    s.rating_avg ?? '0.00',
    s.ratings_count ?? 0,
    s.services_count ?? 0,
    s.team_count ?? 0,
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(';')).join('\n');
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
}
