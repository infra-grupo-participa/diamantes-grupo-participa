// operator.ts — wrapper de cliente (browser) sobre supabase-js para a área do
// operador. Espelha operator/assets/operator-api.js. RLS protege tudo no
// servidor: operador só enxerga o que está em portal.demand_members /
// team_assignments. Use somente em Client Components.

import { createClient } from '@/lib/supabase/client';

const OPERATOR_STATUSES = ['open', 'in_progress', 'review', 'done', 'canceled'] as const;
export type DemandStatus = (typeof OPERATOR_STATUSES)[number];

export type OperatorProfile = {
  id: number;
  role: string;
  status: string;
  name: string | null;
  email: string | null;
  metadata: Record<string, unknown> | null;
  position_id: number | null;
  clickup_user_id: string | null;
  last_login_at: string | null;
  created_at: string | null;
};

export type AssignedDemand = {
  id: string;
  title: string | null;
  description: string | null;
  status: DemandStatus;
  client_slug: string | null;
  client_display_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  ends_at: string | null;
  last_message_at: string | null;
  message_count: number | null;
};

export type Position = {
  id: number;
  slug: string;
  name: string;
  color: string | null;
  active: boolean;
};

export type ReceivedRating = {
  id: string;
  client_slug: string | null;
  task_id: string | null;
  score: number | null;
  comment: string | null;
  created_at: string | null;
  client_display_name?: string | null;
};

export type OperatorRating = {
  id: string;
  score: number;
  comment: string | null;
  dimensions: Record<string, number> | null;
  status: string;
  submitted_at: string | null;
};

export type DashboardKpi = {
  open_count?: number;
  in_progress_count?: number;
  done_today_count?: number;
  rating_avg?: number | null;
  rating_count?: number;
  active_total?: number;
  points_total?: number;
  points_this_month?: number;
  ranking_position?: number | null;
  ranking_total?: number | null;
};

export type WorkloadSlice = { status: DemandStatus; count: number };

export type UrgentItem = {
  id: string;
  title: string;
  client_display_name: string | null;
  days_left: number | null;
};

export type RecentActivity = {
  author_name: string;
  demand_title: string;
  preview: string | null;
  created_at: string | null;
};

export type RecentRatingReceived = {
  score: number;
  demand_title: string | null;
  client_display_name: string | null;
  comment: string | null;
  submitted_at: string | null;
};

export type OperatorDashboard = {
  kpi?: DashboardKpi;
  workload?: WorkloadSlice[];
  urgent?: UrgentItem[];
  recent?: RecentActivity[];
  recent_ratings_received?: RecentRatingReceived[];
  error?: string;
};

export type MyStudent = {
  slug: string;
  display_name: string;
  plan_name?: string | null;
};

const PROFILE_COLS =
  'id, role, status, name, email, metadata, position_id, clickup_user_id, last_login_at, created_at';

function db() {
  return createClient();
}

/** portal.users do logado. */
export async function getMe(): Promise<OperatorProfile | null> {
  const supabase = db();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  const { data } = await supabase
    .from('users')
    .select(PROFILE_COLS)
    .eq('auth_user_id', session.user.id)
    .maybeSingle();
  return (data as OperatorProfile) ?? null;
}

export async function getDashboard(): Promise<OperatorDashboard> {
  const { data, error } = await db().rpc('get_operator_dashboard');
  if (error) throw error;
  return (data as OperatorDashboard) ?? {};
}

export async function listAssignedDemands(
  opts: { status?: DemandStatus | 'all' } = {},
): Promise<AssignedDemand[]> {
  const { status = 'all' } = opts;
  let q = db()
    .from('v_my_assigned_demands')
    .select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (status && status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data as AssignedDemand[]) ?? [];
}

export async function getDemand(id: string): Promise<AssignedDemand | null> {
  const { data, error } = await db()
    .from('v_my_assigned_demands')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as AssignedDemand) ?? null;
}

export async function updateDemandStatus(id: string, status: DemandStatus) {
  if (!OPERATOR_STATUSES.includes(status)) {
    throw new Error('Status inválido: ' + status);
  }
  const { data, error } = await db()
    .from('demands')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, status, updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function listMyStudents(): Promise<MyStudent[]> {
  const { data, error } = await db()
    .from('v_my_students')
    .select('*')
    .order('display_name', { ascending: true });
  if (error) throw error;
  return (data as MyStudent[]) ?? [];
}

export async function listPositions(): Promise<Position[]> {
  const { data, error } = await db()
    .from('positions')
    .select('id, slug, name, color, active')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data as Position[]) ?? [];
}

export type ProfilePatch = {
  name?: string;
  position_id?: number | null;
  metadata?: Record<string, unknown>;
};

export async function updateMe(patch: ProfilePatch): Promise<OperatorProfile> {
  const supabase = db();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada.');

  const clean: Record<string, unknown> = {};
  if (patch.name !== undefined) clean.name = patch.name;
  if (patch.position_id !== undefined) clean.position_id = patch.position_id;

  if (patch.metadata && typeof patch.metadata === 'object') {
    const { data: current } = await supabase
      .from('users')
      .select('metadata')
      .eq('auth_user_id', session.user.id)
      .maybeSingle();
    clean.metadata = Object.assign(
      {},
      (current as { metadata?: Record<string, unknown> })?.metadata || {},
      patch.metadata,
    );
  }
  clean.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('users')
    .update(clean)
    .eq('auth_user_id', session.user.id)
    .select()
    .single();
  if (error) throw error;
  return data as OperatorProfile;
}

export async function changePassword(newPassword: string): Promise<boolean> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('A senha precisa ter no mínimo 8 caracteres.');
  }
  const { error } = await db().auth.updateUser({ password: newPassword });
  if (error) throw error;
  return true;
}

export async function uploadAvatar(file: File): Promise<string> {
  if (!file) throw new Error('Selecione um arquivo.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Arquivo maior que 2 MB.');
  const supabase = db();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada.');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${session.user.id}/avatar.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw upErr;
  const {
    data: { publicUrl },
  } = supabase.storage.from('avatars').getPublicUrl(path);
  await updateMe({ metadata: { avatar_url: publicUrl } });
  return publicUrl;
}

export async function listMyRatings(limit = 50): Promise<ReceivedRating[]> {
  const me = await getMe();
  if (!me) throw new Error('Sessão expirada.');
  const supabase = db();
  const { data, error } = await supabase
    .from('ratings')
    .select('id, client_slug, task_id, score, comment, created_at')
    .eq('user_id', me.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data as ReceivedRating[]) ?? [];
  if (rows.length === 0) return [];

  const slugs = [...new Set(rows.map((r) => r.client_slug).filter(Boolean))] as string[];
  let clientsBySlug: Record<string, { slug: string; display_name: string }> = {};
  if (slugs.length) {
    const { data: clients } = await supabase
      .from('clients')
      .select('slug, display_name')
      .in('slug', slugs);
    clientsBySlug = Object.fromEntries(
      ((clients as { slug: string; display_name: string }[]) || []).map((c) => [c.slug, c]),
    );
  }
  return rows.map((r) => ({
    ...r,
    client_display_name: (r.client_slug && clientsBySlug[r.client_slug]?.display_name) || r.client_slug,
  }));
}

// ── Avaliações (operador → cliente) ──────────────────────────────────────────

export async function getMyOperatorRating(demandId: string): Promise<OperatorRating | null> {
  const me = await getMe();
  if (!me) return null;
  const { data, error } = await db()
    .from('operator_to_client_ratings')
    .select('id, score, comment, dimensions, status, submitted_at')
    .eq('demand_id', demandId)
    .eq('operator_id', me.id)
    .maybeSingle();
  if (error) throw error;
  return (data as OperatorRating) ?? null;
}

export async function submitOperatorRating(
  demandId: string,
  score: number,
  comment: string | null,
  dimensions: Record<string, number>,
) {
  const { data, error } = await db().rpc('submit_operator_rating', {
    p_demand_id: demandId,
    p_score: score,
    p_comment: comment || null,
    p_dimensions: dimensions || {},
  });
  if (error) throw error;
  return data;
}

export async function logout() {
  await db().auth.signOut();
  window.location.replace('/login');
}
