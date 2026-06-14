// API de Demandas (admin) — porta fiel de admin-api.js (listAllDemands,
// getDemandFullDetails, adminUpdateDemandStatus, adminDemandStats,
// listClientsSimple) + carga de membros/operadores usada pelo Kanban.
//
// Tudo via supabase-js no browser, schema `portal` (já configurado em
// lib/supabase/client). RLS bloqueia quem não for admin aprovado.

import { createClient } from '@/lib/supabase/client';

export type DemandStatus = 'open' | 'in_progress' | 'review' | 'done' | 'canceled';

export type Demand = {
  id: string;
  title: string | null;
  description: string | null;
  status: DemandStatus;
  client_slug: string;
  client_name: string | null;
  created_by_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string | null;
  finalized_at: string | null;
  messages_count: number | null;
  clickup_task_id: string | null;
  operators_total: number | null;
  operators_approved: number | null;
  [key: string]: unknown;
};

export type DemandMemberLite = {
  user_id: string;
  role: string;
  approved_finish: boolean | null;
};

export type DemandMemberFull = {
  user_id: string;
  role: string;
  approved_finish: boolean | null;
  user_name: string | null;
  user_email: string | null;
  position_name: string | null;
  position_color: string | null;
  clickup_user_id: string | null;
  [key: string]: unknown;
};

export type DemandMessage = {
  id: string;
  user_id: string;
  content: string | null;
  created_at: string | null;
  author_name: string | null;
  author_role: string | null;
  avatar_url: string | null;
  [key: string]: unknown;
};

export type OperatorUser = {
  id: string;
  name: string | null;
  metadata: Record<string, unknown> | null;
  clickup_user_id: string | null;
};

export type ClientSimple = { slug: string; display_name: string | null };

export type DemandStats = {
  total: number;
  open: number;
  in_progress: number;
  review: number;
  done: number;
  canceled: number;
};

export type DemandFilter = {
  search?: string;
  clientSlug?: string;
  status?: string;
};

const VALID_STATUS: DemandStatus[] = ['open', 'in_progress', 'review', 'done', 'canceled'];

/** Lista todas as demandas (v_demands) com filtros de busca/cliente/status. */
export async function listAllDemands(filter: DemandFilter = {}): Promise<Demand[]> {
  const { search = '', clientSlug = 'all', status = 'all' } = filter;
  const supabase = createClient();
  let q = supabase.from('v_demands').select('*').order('created_at', { ascending: false });
  if (status && status !== 'all') q = q.eq('status', status);
  if (clientSlug && clientSlug !== 'all') q = q.eq('client_slug', clientSlug);
  if (search && search.trim()) {
    const s = search.trim().replace(/[%_]/g, '');
    q = q.or(`title.ilike.%${s}%,client_name.ilike.%${s}%,description.ilike.%${s}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Demand[];
}

/** Carrega os membros (lite) de várias demandas em paralelo, indexados por demand_id. */
export async function loadMembersByDemand(
  demandIds: string[],
): Promise<Record<string, DemandMemberLite[]>> {
  const supabase = createClient();
  const out: Record<string, DemandMemberLite[]> = {};
  await Promise.all(
    demandIds.map(async (id) => {
      const { data, error } = await supabase
        .from('demand_members')
        .select('user_id, role, approved_finish')
        .eq('demand_id', id);
      if (error) throw error;
      out[id] = (data ?? []) as DemandMemberLite[];
    }),
  );
  return out;
}

/** Resolve nomes/avatar/clickup dos operadores em uma query só. */
export async function loadOperatorUsers(ids: string[]): Promise<Record<string, OperatorUser>> {
  if (!ids.length) return {};
  const supabase = createClient();
  const { data } = await supabase
    .from('users')
    .select('id, name, metadata, clickup_user_id')
    .in('id', ids);
  return Object.fromEntries(((data ?? []) as OperatorUser[]).map((u) => [u.id, u]));
}

/** Detalhe completo de uma demanda: demanda + equipe (com cargo/clickup) + chat. */
export async function getDemandFullDetails(demandId: string): Promise<{
  demand: Demand;
  members: DemandMemberFull[];
  messages: DemandMessage[];
} | null> {
  const supabase = createClient();
  const [{ data: demand, error: demandErr }, { data: members, error: membersErr }, { data: messages, error: messagesErr }] =
    await Promise.all([
      supabase.from('v_demands').select('*').eq('id', demandId).maybeSingle(),
      supabase.from('demand_members').select('*').eq('demand_id', demandId),
      supabase.from('demand_messages').select('*').eq('demand_id', demandId).order('created_at'),
    ]);
  if (demandErr) throw demandErr;
  if (membersErr) throw membersErr;
  if (messagesErr) throw messagesErr;
  if (!demand) return null;

  const memberRows = (members ?? []) as Array<Record<string, unknown>>;
  const messageRows = (messages ?? []) as Array<Record<string, unknown>>;

  const userIds = [
    ...new Set([
      ...memberRows.map((m) => m.user_id as string),
      ...messageRows.map((m) => m.user_id as string),
    ]),
  ].filter(Boolean);

  let usersById: Record<string, Record<string, unknown>> = {};
  if (userIds.length) {
    const { data: users } = await supabase
      .from('users')
      .select('id, name, email, role, position_id, metadata, clickup_user_id')
      .in('id', userIds);
    usersById = Object.fromEntries(
      ((users ?? []) as Array<Record<string, unknown>>).map((u) => [u.id as string, u]),
    );
    const pids = [
      ...new Set(
        ((users ?? []) as Array<Record<string, unknown>>)
          .map((u) => u.position_id as number | null)
          .filter(Boolean),
      ),
    ];
    if (pids.length) {
      const { data: positions } = await supabase
        .from('positions')
        .select('id, name, color')
        .in('id', pids);
      const positionsById = Object.fromEntries(
        ((positions ?? []) as Array<Record<string, unknown>>).map((p) => [p.id as number, p]),
      );
      Object.values(usersById).forEach((u) => {
        const p = positionsById[u.position_id as number];
        if (p) {
          u._position_name = p.name;
          u._position_color = p.color;
        }
      });
    }
  }

  const memb: DemandMemberFull[] = memberRows.map((m) => {
    const u = usersById[m.user_id as string] ?? {};
    return {
      ...m,
      user_id: m.user_id as string,
      role: m.role as string,
      approved_finish: (m.approved_finish as boolean | null) ?? null,
      user_name: (u.name as string) ?? null,
      user_email: (u.email as string) ?? null,
      position_name: (u._position_name as string) ?? null,
      position_color: (u._position_color as string) ?? null,
      clickup_user_id: (u.clickup_user_id as string) ?? null,
    };
  });

  const msgs: DemandMessage[] = messageRows.map((m) => {
    const u = usersById[m.user_id as string] ?? {};
    const meta = (u.metadata as Record<string, unknown> | null) ?? null;
    return {
      ...m,
      id: m.id as string,
      user_id: m.user_id as string,
      content: (m.content as string) ?? null,
      created_at: (m.created_at as string) ?? null,
      author_name: (u.name as string) ?? null,
      author_role: (u.role as string) ?? null,
      avatar_url: (meta?.avatar_url as string) ?? null,
    };
  });

  return { demand: demand as Demand, members: memb, messages: msgs };
}

/** Muda o status de uma demanda (com finalized_at quando done). */
export async function adminUpdateDemandStatus(
  id: string,
  status: DemandStatus,
): Promise<Demand> {
  if (!VALID_STATUS.includes(status)) throw new Error('Status inválido.');
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === 'done') patch.finalized_at = new Date().toISOString();
  const supabase = createClient();
  const { data, error } = await supabase
    .from('demands')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Demand;
}

/** Contadores macro (5 KPIs + canceled) — sem filtro. */
export async function adminDemandStats(): Promise<DemandStats> {
  const supabase = createClient();
  const [open, prog, review, done, canceled, all] = await Promise.all([
    supabase.from('demands').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('demands').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
    supabase.from('demands').select('id', { count: 'exact', head: true }).eq('status', 'review'),
    supabase.from('demands').select('id', { count: 'exact', head: true }).eq('status', 'done'),
    supabase.from('demands').select('id', { count: 'exact', head: true }).eq('status', 'canceled'),
    supabase.from('demands').select('id', { count: 'exact', head: true }),
  ]);
  for (const r of [open, prog, review, done, canceled, all]) {
    if (r.error) throw r.error;
  }
  return {
    total: all.count ?? 0,
    open: open.count ?? 0,
    in_progress: prog.count ?? 0,
    review: review.count ?? 0,
    done: done.count ?? 0,
    canceled: canceled.count ?? 0,
  };
}

/** Lista simples de clientes (para filtro + view por aluno). */
export async function listClientsSimple(): Promise<ClientSimple[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('clients')
    .select('slug, display_name')
    .order('display_name');
  if (error) throw error;
  return (data ?? []) as ClientSimple[];
}

// ── Helpers de UI portados do legado ─────────────────────────────

export const STATUS_BADGE: Record<DemandStatus, { cls: string; label: string }> = {
  open: { cls: 'bOpen', label: 'Aberta' },
  in_progress: { cls: 'bProg', label: 'Em andamento' },
  review: { cls: 'bReview', label: 'Em revisão' },
  done: { cls: 'bDone', label: 'Concluída' },
  canceled: { cls: 'bCancel', label: 'Cancelada' },
};

export type DueLabel = { text: string; cls: '' | 'late' | 'soon' };

/** Rótulo de prazo (espelha dueLabel do legado). */
export function dueLabel(d: Demand): DueLabel {
  if (d.status === 'done') {
    const dt = d.finalized_at
      ? new Date(d.finalized_at).toLocaleDateString('pt-BR')
      : '—';
    return { text: 'Concluída em ' + dt, cls: '' };
  }
  if (d.status === 'canceled') return { text: 'Cancelada', cls: '' };
  if (!d.ends_at) return { text: 'Sem prazo', cls: '' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(d.ends_at);
  const diff = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { text: 'Atrasada há ' + Math.abs(diff) + 'd', cls: 'late' };
  if (diff === 0) return { text: 'Vence hoje', cls: 'late' };
  if (diff === 1) return { text: 'Vence amanhã', cls: 'soon' };
  if (diff <= 3) return { text: 'Em ' + diff + ' dias', cls: 'soon' };
  return { text: new Date(d.ends_at).toLocaleDateString('pt-BR'), cls: '' };
}

export const clickupTaskUrl = (taskId: string) => `https://app.clickup.com/t/${taskId}`;
