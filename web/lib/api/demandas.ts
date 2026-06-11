// API de Demandas do cliente — port das funções de demanda de portal-api.js.
// Client-side (RLS protege). Espelha fielmente o backend (schema portal):
// view v_demands, tabelas demand_members/demand_operators/operators/positions,
// team_assignments, ratings, projects, e RPCs create_demand / finalize_my_part /
// submit_client_rating / get_client_briefing.

import { createClient } from '@/lib/supabase/client';

export type DemandStatus = 'open' | 'in_progress' | 'review' | 'done' | 'canceled';

export type Demand = {
  id: string;
  title: string | null;
  description: string | null;
  status: DemandStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  finalized_at: string | null;
  project_id?: string | null;
  [k: string]: unknown;
};

export type DemandMember = {
  id: string | number;
  user_id: number;
  role: string;
  approved_finish: boolean;
  approved_at: string | null;
  added_at: string | null;
  user_name: string | null;
  user_email: string | null;
  user_role: string | null;
  avatar_url: string | null;
  position_name: string | null;
  position_color: string | null;
};

export type Operator = {
  id: number;
  name: string;
  email: string | null;
  position_id: number | null;
  position_name: string | null;
  position_color: string | null;
  avatar_url: string | null;
};

export type Rating = {
  id: string | number;
  score: number;
  comment: string | null;
  status: 'pending' | 'submitted' | string;
  submitted_at: string | null;
};

export type Project = {
  id: string;
  title: string | null;
  services: string[] | null;
  briefing: Record<string, unknown> | null;
  briefing_status: string | null;
  status: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type Me = {
  id: number;
  name: string | null;
  email: string | null;
  client_slug: string | null;
  metadata: { avatar_url?: string } | null;
};

export type FinalizeResult = {
  status: DemandStatus;
  approved?: number;
  total_operators?: number;
  finalized_at?: string | null;
};

function db() {
  return createClient();
}

/** Perfil do logado (portal.users). */
export async function getMe(): Promise<Me | null> {
  const supabase = db();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, client_slug, metadata')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  return data as Me | null;
}

/** Demandas do cliente (view v_demands), mais recentes primeiro. */
export async function listMyDemands(status: string = 'all'): Promise<Demand[]> {
  let q = db().from('v_demands').select('*').order('created_at', { ascending: false });
  if (status && status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as Demand[];
}

export async function getDemand(id: string): Promise<Demand | null> {
  const { data, error } = await db().from('v_demands').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Demand) || null;
}

/** Membros da demanda: clientes (demand_members) + operadores (demand_operators → operators/positions). */
export async function getDemandMembers(demandId: string): Promise<DemandMember[]> {
  const supabase = db();
  const result: DemandMember[] = [];

  // 1. Clientes via demand_members → portal.users (exclui operadores)
  const { data: memberRows, error } = await supabase
    .from('demand_members')
    .select('id, user_id, role, approved_finish, approved_at, added_at')
    .eq('demand_id', demandId)
    .neq('role', 'operator');
  if (error) throw error;

  if (memberRows?.length) {
    const ids = memberRows.map((m) => m.user_id);
    const { data: users } = await supabase.from('users').select('id, name, email, role, position_id, metadata').in('id', ids);
    const usersById = Object.fromEntries((users || []).map((u) => [u.id, u]));
    for (const m of memberRows) {
      const u = usersById[m.user_id] || {};
      result.push({
        ...m,
        user_name: u.name ?? null,
        user_email: u.email ?? null,
        user_role: u.role ?? null,
        avatar_url: u.metadata?.avatar_url || null,
        position_name: null,
        position_color: null,
      } as DemandMember);
    }
  }

  // 2. Operadores via demand_operators → portal.operators (+ positions)
  const { data: opRows } = await supabase
    .from('demand_operators')
    .select('id, operator_id, role, added_at')
    .eq('demand_id', demandId);

  if (opRows?.length) {
    const opIds = opRows.map((r) => r.operator_id);
    const { data: ops } = await supabase.from('operators').select('id, name, email, position_id, metadata').in('id', opIds);
    const opsById = Object.fromEntries((ops || []).map((o) => [o.id, o]));
    const posIds = [...new Set((ops || []).map((o) => o.position_id).filter(Boolean))];
    let posById: Record<number, { name?: string; color?: string }> = {};
    if (posIds.length) {
      const { data: positions } = await supabase.from('positions').select('id, name, color').in('id', posIds);
      posById = Object.fromEntries((positions || []).map((p) => [p.id, p]));
    }
    for (const r of opRows) {
      const o = opsById[r.operator_id] || {};
      const p = (o.position_id != null ? posById[o.position_id] : null) || null;
      result.push({
        id: r.id,
        user_id: r.operator_id, // sintético: operator_id como user_id para display
        role: 'operator',
        approved_finish: false,
        approved_at: null,
        added_at: r.added_at,
        user_name: o.name ?? null,
        user_email: o.email ?? null,
        user_role: 'operator',
        avatar_url: o.metadata?.avatar_url || null,
        position_name: p?.name || null,
        position_color: p?.color || null,
      });
    }
  }

  return result;
}

async function enrichOperators(
  rows: Array<{ id: number; name: string; email: string | null; position_id: number | null; metadata?: { avatar_url?: string } }>,
): Promise<Operator[]> {
  const supabase = db();
  const pids = [...new Set(rows.map((u) => u.position_id).filter(Boolean))] as number[];
  let positionsById: Record<number, { name?: string; color?: string }> = {};
  if (pids.length) {
    const { data: positions } = await supabase.from('positions').select('id, name, color').in('id', pids);
    positionsById = Object.fromEntries((positions || []).map((p) => [p.id, p]));
  }
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    position_id: u.position_id,
    position_name: (u.position_id != null && positionsById[u.position_id]?.name) || null,
    position_color: (u.position_id != null && positionsById[u.position_id]?.color) || null,
    avatar_url: u.metadata?.avatar_url || null,
  }));
}

/** Operadores disponíveis: via team_assignments do cliente; se vazio, todos ativos. */
export async function listOperatorsForClient(): Promise<Operator[]> {
  const supabase = db();
  const me = await getMe();
  if (!me) throw new Error('Sessão expirada.');

  const { data: assignments, error } = await supabase
    .from('team_assignments')
    .select('operator_id')
    .eq('client_slug', me.client_slug)
    .not('operator_id', 'is', null);
  if (error) throw error;

  const opIds = (assignments || []).map((t) => t.operator_id).filter(Boolean);
  if (opIds.length === 0) {
    const { data: all } = await supabase
      .from('operators')
      .select('id, name, email, position_id, metadata')
      .eq('status', 'active')
      .eq('contract_active', true)
      .order('name');
    return enrichOperators(all || []);
  }
  const { data: ops } = await supabase.from('operators').select('id, name, email, position_id, metadata').in('id', opIds);
  return enrichOperators(ops || []);
}

export type CreateDemandInput = {
  title: string;
  description?: string | null;
  operator_ids: Array<number | string>;
  project_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
};

/** Cria demanda via RPC create_demand. */
export async function createDemand(input: CreateDemandInput): Promise<Demand> {
  if (!input.title || !input.title.trim()) throw new Error('Título obrigatório.');
  if (!input.operator_ids || input.operator_ids.length === 0) throw new Error('Selecione pelo menos um operador.');
  const { data, error } = await db().rpc('create_demand', {
    p_title: input.title.trim(),
    p_description: input.description || null,
    p_operators: input.operator_ids,
    p_project_id: input.project_id || null,
    p_starts_at: input.starts_at || null,
    p_ends_at: input.ends_at || null,
  });
  if (error) throw error;
  return data as Demand;
}

/** Operador membro finaliza sua parte (RPC). Conclui quando todos aprovam. */
export async function finalizeMyPart(demandId: string): Promise<FinalizeResult> {
  const { data, error } = await db().rpc('finalize_my_part', { p_demand_id: demandId });
  if (error) throw error;
  return data as FinalizeResult;
}

/** Rating mais recente da demanda (pending ou submitted), ou null. */
export async function getMyDemandRating(demandId: string): Promise<Rating | null> {
  const { data, error } = await db()
    .from('ratings')
    .select('id, score, comment, status, submitted_at')
    .eq('demand_id', demandId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Rating) || null;
}

/** Avaliação do cliente (nota 1-10 + comentário) via RPC. */
export async function submitClientRating(demandId: string, score: number, comment?: string): Promise<unknown> {
  const { data, error } = await db().rpc('submit_client_rating', {
    p_demand_id: demandId,
    p_score: score,
    p_comment: comment || null,
  });
  if (error) throw error;
  return data;
}

/** Projetos do cliente (para o modo "projeto" da nova demanda). */
export async function listMyProjects(): Promise<Project[]> {
  const { data, error } = await db()
    .from('projects')
    .select('id, title, services, briefing, briefing_status, status, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as Project[];
}

/** Gate: cliente já concluiu o Briefing Básico? (RPC get_client_briefing). */
export async function isBaseReady(): Promise<boolean> {
  try {
    const { data, error } = await db().rpc('get_client_briefing');
    if (error) return false;
    return !!data && (data as { base_status?: string }).base_status === 'submitted';
  } catch {
    return false;
  }
}
