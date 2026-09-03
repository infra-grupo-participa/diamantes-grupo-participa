// API de Demandas (admin) — porta fiel de admin-api.js (listAllDemands,
// getDemandFullDetails, adminUpdateDemandStatus, adminDemandStats,
// listClientsSimple) + carga de membros/operadores usada pelo Kanban.
//
// Tudo via supabase-js no browser, schema `portal` (já configurado em
// lib/supabase/client). RLS bloqueia quem não for admin aprovado.

import { createClient } from '@/lib/supabase/client';

export type DemandStatus = 'open' | 'in_progress' | 'review' | 'done' | 'canceled';

/**
 * Estado da última comparação portal vs ClickUp para os assignees da task
 * (portal.demands.clickup_assignee_sync — migration 086, revisada 2026-09-01 pós-teste
 * real na API). `null` = nunca sincronizado (demanda sem clickup_task_id ou anterior a
 * este lote). Detecção é por COMPARAÇÃO pós-resposta (o ClickUp aceita HTTP 200 e
 * descarta assignee guest em silêncio quando a lista mistura member+guest — não há
 * exceção para capturar isso), nunca por watcher (endpoint não existe na API v2).
 *   ok               → todos os operadores da demanda estão como assignee no ClickUp.
 *   partial          → 1+ operador esperado ficou de fora por causa NÃO-permanente
 *                       (ex.: espaço momentaneamente single-assignee) — acionável.
 *   partial_expected → 1+ operador ficou de fora e a causa é 100% GUEST no ClickUp
 *                       (clickup_assignee_detail.permanent === true). Estado ESPERADO
 *                       enquanto a decisão for manter guest (Marcio) — NÃO é erro a
 *                       corrigir. O painel não deve tratar como pendência acionável nem
 *                       alertar repetidamente (o e-mail ao admin já só dispara 1x).
 *   none             → nenhum operador esperado da demanda está como assignee.
 *   external         → o ClickUp tem assignee(s) que o portal não reconhece (mudança
 *                       feita direto no ClickUp) — populado só pelo webhook.
 */
export type AssigneeSyncState = 'ok' | 'partial' | 'partial_expected' | 'none' | 'external' | null;

/**
 * Item de `clickup_assignee_detail.missing[]` (estados partial/partial_expected/none).
 * `no_clickup_user` e `stale_clickup_user` (migration 086/087, revisão do arquiteto
 * 2026-09-03): antes o operador sem clickup_user_id era filtrado ANTES da comparação
 * (a razão 'no_clickup_user' nunca aparecia de fato) e não existia distinção entre
 * "é guest" e "ID cadastrado não existe mais no workspace" (fantasma, ex. Gabriel
 * Alves 230453991) — os dois caíam em 'unknown_rejected', que virava lixeira.
 */
export type AssigneeDivergenceReason =
  | 'guest_cannot_assign'
  | 'space_single_assignee'
  | 'no_clickup_user'
  | 'stale_clickup_user'
  | 'unknown_rejected';
export type MissingAssignee = { name: string | null; clickup_user_id: number | null; reason: AssigneeDivergenceReason };

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
  clickup_assignee_sync: AssigneeSyncState;
  /**
   * Presente só quando a query pede explicitamente (detalhe do modal). Na
   * LISTAGEM (`listAllDemands`/`getProjectPanorama`) não é carregado — o jsonb
   * pode crescer livremente e não deve pesar toda tela de demandas.
   */
  clickup_assignee_detail?: Record<string, unknown> | null;
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
  /** Teto rígido em 200 dentro de `listAllDemands` — ver comentário da função. */
  limit?: number;
};

const VALID_STATUS: DemandStatus[] = ['open', 'in_progress', 'review', 'done', 'canceled'];

/**
 * Lista todas as demandas (v_demands) com filtros de busca/cliente/status.
 * `limit` tem teto: a view tem 5 subqueries correlacionadas por linha
 * (operators_total, messages_count, last_message_at/preview/from) que rodam
 * UMA VEZ POR LINHA retornada — sem teto o custo cresce linearmente com o
 * volume de demandas (egress do Supabase é restrição real, ver
 * docs/specs/pendencias/086-087-explain-pendente.md). 200 é generoso para o
 * uso real: o Kanban/listagem do painel (`app/admin/demandas/page.tsx`) é
 * operacional, não relatório histórico, e hoje tem 16 demandas no total.
 */
export async function listAllDemands(filter: DemandFilter = {}): Promise<Demand[]> {
  const { search = '', clientSlug = 'all', status = 'all', limit = 200 } = filter;
  const capped = Math.min(200, Math.max(1, limit));
  const supabase = createClient();
  let q = supabase
    .from('v_demands')
    .select(
      `id, client_slug, client_name, title, description, status, starts_at, ends_at,
       clickup_task_id, finalized_at, created_at, updated_at, service_type, briefing_status,
       created_by_name, operators_total, messages_count, last_message_at, project_id,
       project_title, last_message_preview, last_message_from, clickup_assignee_sync`,
    )
    .order('created_at', { ascending: false })
    .limit(capped);
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

/** Carrega os membros (lite) de várias demandas em UMA query (.in), indexados por demand_id. */
export async function loadMembersByDemand(
  demandIds: string[],
): Promise<Record<string, DemandMemberLite[]>> {
  const out: Record<string, DemandMemberLite[]> = {};
  const ids = [...new Set((demandIds || []).filter(Boolean))];
  if (ids.length === 0) return out;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('demand_members')
    .select('demand_id, user_id, role, approved_finish')
    .in('demand_id', ids);
  if (error) throw error;
  for (const row of (data ?? []) as Array<DemandMemberLite & { demand_id: string }>) {
    (out[row.demand_id] ||= []).push({
      user_id: row.user_id,
      role: row.role,
      approved_finish: row.approved_finish,
    });
  }
  return out;
}

/** Operador "lite" para os avatares dos cards (Kanban / por aluno). */
export type DemandOperatorLite = { operator_id: string; name: string | null };

/**
 * Operadores REAIS atribuídos a várias demandas, indexados por demand_id.
 * Fonte: demand_operators → operators (mesma do detalhe e do panorama do projeto).
 * Substitui o caminho antigo via demand_members (onde operadores nunca existem).
 */
export async function loadOperatorsByDemand(
  demandIds: string[],
): Promise<Record<string, DemandOperatorLite[]>> {
  const out: Record<string, DemandOperatorLite[]> = {};
  const ids = [...new Set((demandIds || []).filter(Boolean))];
  if (ids.length === 0) return out;
  const supabase = createClient();
  const { data: links, error } = await supabase
    .from('demand_operators')
    .select('demand_id, operator_id')
    .in('demand_id', ids);
  if (error) throw error;
  const rows = (links ?? []) as Array<{ demand_id: string; operator_id: string }>;
  const opIds = [...new Set(rows.map((r) => r.operator_id))];
  let nameById: Record<string, string | null> = {};
  if (opIds.length) {
    const { data: ops, error: e2 } = await supabase.from('operators').select('id, name').in('id', opIds);
    if (e2) throw e2;
    nameById = Object.fromEntries(
      ((ops ?? []) as Array<{ id: string; name: string | null }>).map((o) => [o.id, o.name]),
    );
  }
  for (const r of rows) {
    (out[r.demand_id] ||= []).push({ operator_id: r.operator_id, name: nameById[r.operator_id] ?? null });
  }
  return out;
}

/** Resolve nomes/avatar/clickup dos operadores em uma query só. */
export async function loadOperatorUsers(ids: string[]): Promise<Record<string, OperatorUser>> {
  if (!ids.length) return {};
  const supabase = createClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, name, metadata, clickup_user_id')
    .in('id', ids);
  if (error) throw error;
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
      supabase
        .from('v_demands')
        .select(
          `id, client_slug, client_name, title, description, status, starts_at, ends_at,
           clickup_task_id, finalized_at, created_at, updated_at, service_type, briefing_status,
           created_by_name, operators_total, messages_count, last_message_at, project_id,
           project_title, last_message_preview, last_message_from, clickup_assignee_sync,
           clickup_assignee_detail`,
        )
        .eq('id', demandId)
        .maybeSingle(),
      supabase
        .from('demand_members')
        .select('id, demand_id, user_id, role, approved_finish, approved_at, added_at')
        .eq('demand_id', demandId),
      supabase
        .from('demand_messages')
        .select('id, demand_id, user_id, content, created_at, clickup_author')
        .eq('demand_id', demandId)
        .order('created_at'),
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
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, name, email, role, position_id, metadata, clickup_user_id')
      .in('id', userIds);
    if (usersErr) throw usersErr;
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
      const { data: positions, error: positionsErr } = await supabase
        .from('positions')
        .select('id, name, color')
        .in('id', pids);
      if (positionsErr) throw positionsErr;
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
      author_name: (u.name as string) ?? (m.clickup_author as string) ?? null,
      author_role: (u.role as string) ?? (m.clickup_author ? 'operator' : null),
      avatar_url: (meta?.avatar_url as string) ?? null,
    };
  });

  return { demand: demand as Demand, members: memb, messages: msgs };
}

// ── Operadores da demanda (responsáveis reais — tabela demand_operators) ──────

/**
 * Estado de entrega do assignee no ClickUp por operador (portal.demand_operators
 * .clickup_delivery — coluna nova, ainda não aplicada no banco nesta sessão).
 * 'unknown' é o fallback seguro: coluna ausente/não gravada ainda, não é erro.
 */
export type ClickupDeliveryState = 'delivered' | 'blocked_guest' | 'blocked_other' | 'no_clickup_user' | 'unknown';

export const CLICKUP_DELIVERY_LABEL: Record<ClickupDeliveryState, { cls: string; label: string }> = {
  delivered: { cls: 'deliveryDelivered', label: 'Entregue' },
  blocked_guest: { cls: 'deliveryBlockedGuest', label: 'Bloqueado (guest)' },
  blocked_other: { cls: 'deliveryBlockedOther', label: 'Bloqueado (outro motivo)' },
  no_clickup_user: { cls: 'deliveryNoClickup', label: 'Sem cadastro no ClickUp' },
  unknown: { cls: 'deliveryUnknown', label: 'Estado desconhecido' },
};

export type DemandOperator = {
  operator_id: string;
  name: string | null;
  email: string | null;
  clickup_user_id: string | null;
  position_name: string | null;
  position_color: string | null;
  /** Só populado por `getDemandOperators` (contexto de UMA demanda). Ausente
   *  no panorama do projeto (agrega várias demandas — não há um "estado de
   *  entrega" único por operador nesse escopo). */
  clickup_delivery?: ClickupDeliveryState;
};

/** Operadores atualmente atribuídos à demanda (demand_operators → operators). */
export async function getDemandOperators(demandId: string): Promise<DemandOperator[]> {
  const supabase = createClient();
  // clickup_delivery é coluna nova (backend em paralelo): se ainda não existir no
  // banco, a query com a coluna falha com 42703 (undefined_column) — cai para o
  // select sem ela e cada operador vira 'unknown', sem quebrar a tela.
  let dops: Array<{ operator_id: string; clickup_delivery?: string | null }> | null = null;
  {
    const { data, error } = await supabase
      .from('demand_operators')
      .select('operator_id, clickup_delivery')
      .eq('demand_id', demandId);
    if (error) {
      if (error.code === '42703') {
        const fallback = await supabase.from('demand_operators').select('operator_id').eq('demand_id', demandId);
        if (fallback.error) throw fallback.error;
        dops = (fallback.data ?? []) as Array<{ operator_id: string }>;
      } else {
        throw error;
      }
    } else {
      dops = data as Array<{ operator_id: string; clickup_delivery?: string | null }>;
    }
  }
  const deliveryByOp: Record<string, ClickupDeliveryState> = {};
  for (const row of dops ?? []) {
    deliveryByOp[row.operator_id] = (row.clickup_delivery as ClickupDeliveryState) || 'unknown';
  }
  const ids = [...new Set((dops ?? []).map((d) => d.operator_id))];
  if (!ids.length) return [];
  const { data: ops, error: e2 } = await supabase
    .from('operators')
    .select('id, name, email, clickup_user_id, position_id')
    .in('id', ids);
  if (e2) throw e2;
  const rows = (ops ?? []) as Array<Record<string, unknown>>;
  const pids = [...new Set(rows.map((o) => o.position_id).filter(Boolean))] as Array<string | number>;
  let posById: Record<string, { name?: string; color?: string }> = {};
  if (pids.length) {
    const { data: positions } = await supabase.from('positions').select('id, name, color').in('id', pids);
    posById = Object.fromEntries(((positions ?? []) as Array<Record<string, unknown>>).map((p) => [String(p.id), p as { name?: string; color?: string }]));
  }
  return rows.map((o) => ({
    operator_id: o.id as string,
    name: (o.name as string) ?? null,
    email: (o.email as string) ?? null,
    clickup_user_id: (o.clickup_user_id as string) ?? null,
    position_name: posById[String(o.position_id)]?.name ?? null,
    position_color: posById[String(o.position_id)]?.color ?? null,
    clickup_delivery: deliveryByOp[o.id as string] ?? 'unknown',
  }));
}

/**
 * Operadores ativos (para o seletor de adicionar à demanda). `clickup_notifiable`
 * (portal.operators — coluna nova do backend) indica se o operador RECEBE no
 * ClickUp; ausente/coluna inexistente → `null` (estado desconhecido, não afirma
 * nada) para não sugerir falsamente que o operador é notificável.
 */
export async function listActiveOperators(): Promise<Array<DemandOperator & { clickup_notifiable: boolean | null }>> {
  const supabase = createClient();
  let data: Array<Record<string, unknown>> | null = null;
  {
    const res = await supabase
      .from('v_operators')
      .select('id, name, email, clickup_user_id, position_name, position_color, status, clickup_notifiable')
      .neq('status', 'inactive')
      .order('name', { ascending: true });
    if (res.error) {
      if (res.error.code === '42703') {
        const fallback = await supabase
          .from('v_operators')
          .select('id, name, email, clickup_user_id, position_name, position_color, status')
          .neq('status', 'inactive')
          .order('name', { ascending: true });
        if (fallback.error) throw fallback.error;
        data = fallback.data as Array<Record<string, unknown>>;
      } else {
        throw res.error;
      }
    } else {
      data = res.data as Array<Record<string, unknown>>;
    }
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((o) => ({
    operator_id: o.id as string,
    name: (o.name as string) ?? null,
    email: (o.email as string) ?? null,
    clickup_user_id: (o.clickup_user_id as string) ?? null,
    clickup_delivery: 'unknown' as ClickupDeliveryState,
    clickup_notifiable: (o.clickup_notifiable as boolean | undefined) ?? null,
    position_name: (o.position_name as string) ?? null,
    position_color: (o.position_color as string) ?? null,
  }));
}

/** Atribui um operador à demanda (RPC; re-sincroniza assignees no ClickUp). */
export async function addDemandOperator(demandId: string, operatorId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('admin_add_demand_operator', { p_demand_id: demandId, p_operator_id: operatorId });
  if (error) throw new Error(error.message || 'Não foi possível adicionar o operador.');
}

/** Remove um operador da demanda (RPC; re-sincroniza assignees no ClickUp). */
export async function removeDemandOperator(demandId: string, operatorId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('admin_remove_demand_operator', { p_demand_id: demandId, p_operator_id: operatorId });
  if (error) throw new Error(error.message || 'Não foi possível remover o operador.');
}

export type AssigneeDivergenceAction = 'reapply' | 'accept_clickup' | 'dismiss';

/**
 * Resolve manualmente uma divergência de responsáveis entre portal e ClickUp
 * (RPC admin_resolve_assignee_divergence — migration 086). O admin decide:
 *   'reapply'       → reaplica o estado do portal no ClickUp (não muda demand_operators).
 *   'accept_clickup' → reescreve demand_operators a partir do estado real do ClickUp.
 *   'dismiss'        → marca a divergência como revisada, sem alterar nada.
 */
export async function resolveAssigneeDivergence(
  demandId: string,
  action: AssigneeDivergenceAction,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('admin_resolve_assignee_divergence', {
    p_demand_id: demandId,
    p_action: action,
  });
  if (error) throw new Error(error.message || 'Não foi possível resolver a divergência de responsáveis.');
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

/**
 * Rótulo + classe CSS do badge de sincronização de responsáveis (card e lista).
 * `partial_expected` é NEUTRO por decisão de produto (guest permanente, não é
 * erro) — só `partial`/`none`/`external` são acionáveis (âmbar/vermelho).
 * `null`/`ok` não geram badge (ver `hasSyncBadge`).
 */
export const ASSIGNEE_SYNC_BADGE: Record<
  Exclude<AssigneeSyncState, null>,
  { cls: string; icon: string; label: string }
> = {
  ok: { cls: 'syncOk', icon: '✓', label: 'Sincronizado' },
  partial_expected: { cls: 'syncPartialExpected', icon: '–', label: '1+ fora do ClickUp (guest)' },
  partial: { cls: 'syncPartial', icon: '!', label: 'Divergência parcial' },
  none: { cls: 'syncNone', icon: '×', label: 'Nenhum responsável no ClickUp' },
  external: { cls: 'syncExternal', icon: '⇄', label: 'Alterado direto no ClickUp' },
};

/** `true` quando vale a pena mostrar o badge (oculta 'ok' e null — sem ruído). */
export function hasSyncBadge(state: AssigneeSyncState): state is Exclude<AssigneeSyncState, 'ok' | null> {
  return !!state && state !== 'ok';
}

export function assigneeSyncBadge(state: AssigneeSyncState) {
  if (!state) return null;
  return ASSIGNEE_SYNC_BADGE[state] ?? null;
}

// ── Fila de pendências de responsáveis (painel admin) ──────────────────────

/**
 * Estados que entram na FILA DE PENDÊNCIAS do painel — precisam de ação do admin.
 * 'partial_expected' fica FORA de propósito (estado esperado permanente enquanto a
 * decisão for manter guest — não é pendência). Esta lista tem que casar CARACTERE A
 * CARACTERE com o WHERE do índice parcial idx_demands_assignee_pending (migration 086)
 * — casamento PROVADO em produção (EXPLAIN de 03/09/2026 colado em
 * docs/specs/pendencias/086-087-explain-pendente.md: Index Scan no índice parcial).
 * Mudar aqui sem mudar lá (ou vice-versa) faz o planner deixar de usar o índice,
 * silenciosamente.
 */
const PENDING_ASSIGNEE_STATES: Exclude<AssigneeSyncState, 'ok' | 'partial_expected' | null>[] = [
  'partial',
  'none',
  'external',
];

/**
 * Fila de demandas com divergência de responsáveis ACIONÁVEL pelo admin (badge de
 * pendências do painel). Usa o índice parcial idx_demands_assignee_pending
 * (created_at desc) WHERE clickup_assignee_sync IN ('partial','none','external') —
 * MESMA lista de PENDING_ASSIGNEE_STATES acima (EXPLAIN de confirmação executado em
 * 03/09/2026, ver docs/specs/pendencias/086-087-explain-pendente.md). `limit` tem teto:
 * sem paginação full-table (egress do Supabase é restrição real) — a fila é
 * operacional, não um relatório histórico, então um teto de 100 é generoso mesmo em
 * pico.
 */
export async function listPendingAssigneeDivergences(limit = 50): Promise<Demand[]> {
  const capped = Math.min(100, Math.max(1, limit));
  const supabase = createClient();
  const { data, error } = await supabase
    .from('v_demands')
    .select(
      `id, client_slug, client_name, title, status, clickup_task_id, created_at,
       operators_total, clickup_assignee_sync, clickup_assignee_detail`,
    )
    .in('clickup_assignee_sync', PENDING_ASSIGNEE_STATES)
    .order('created_at', { ascending: false })
    .limit(capped);
  if (error) throw error;
  return (data ?? []) as Demand[];
}

// Status de drift do schema (repo × banco): ver `lib/api/admin-drift.ts`
// (getSchemaDriftStatus) — RPC `get_schema_drift_status`, migration 087. Não
// duplicado aqui: o módulo de drift já existe com fallback gracioso para RPC
// ainda não deployada (42883/PGRST202 → null, em vez de estourar erro).
