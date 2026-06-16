import { createClient } from '@/lib/supabase/server';
import {
  getGeneralFields,
  getProjectSections,
  validateProjectBriefing,
  type ProjectBriefing,
} from '@/lib/briefing-templates';

// Tipos frouxos (RPCs retornam jsonb; backend é a fonte da verdade).
export type DashboardData = {
  user?: { name?: string; email?: string };
  client?: { display_name?: string; primary_color?: string };
  profile?: Record<string, unknown> & { contractStartedAt?: string; contract_started_at?: string };
  team?: Array<{ user_name?: string; position_name?: string; position_color?: string }>;
  services?: Array<{ service_type?: string; status?: string }>;
  activity?: Array<{ event?: string; metadata?: Record<string, unknown>; created_at?: string }>;
};

export type ClientBriefing = {
  client_slug?: string;
  access?: Record<string, unknown>;
  base_status?: string;
  pending_flags?: unknown[];
  submitted_at?: string | null;
  services?: string[];
};

export async function getDashboard(): Promise<DashboardData> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_my_dashboard');
  if (error) throw error;
  return (data ?? {}) as DashboardData;
}

export async function getClientBriefing(): Promise<ClientBriefing | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_client_briefing');
  if (error) return null;
  return (data ?? null) as ClientBriefing | null;
}

export async function isBaseReady(): Promise<boolean> {
  try {
    const b = await getClientBriefing();
    return b?.base_status === 'submitted';
  } catch {
    return false;
  }
}

export type DashAttentionItem = {
  id: string;
  title: string | null;
  status: string | null;
  ends_at: string | null;
  project_title?: string | null;
  reason: 'review' | 'reply' | 'deadline';
};

export type DashboardExtras = {
  demands: { total: number; open: number; in_progress: number; review: number; done: number };
  projects: { total: number; active: number; completed: number };
  pendingRatings: number;
  attention: DashAttentionItem[];
};

/**
 * Resumo prático para a tela inicial: contadores de demandas/projetos, avaliações
 * pendentes e a lista "precisam de você" (em revisão, resposta da equipe ou prazo perto).
 * Tudo no servidor (RLS restringe ao cliente logado). Tolerante a falhas parciais.
 */
export async function getDashboardExtras(): Promise<DashboardExtras> {
  const supabase = createClient();
  const empty: DashboardExtras = {
    demands: { total: 0, open: 0, in_progress: 0, review: 0, done: 0 },
    projects: { total: 0, active: 0, completed: 0 },
    pendingRatings: 0,
    attention: [],
  };

  const [demRes, projRes, ratRes] = await Promise.all([
    supabase.from('v_demands').select('id, title, status, ends_at, project_title, last_message_from'),
    supabase.from('projects').select('id, status'),
    supabase.rpc('get_my_pending_project_ratings'),
  ]);

  const demands = (demRes.data ?? []) as Array<{
    id: string; title: string | null; status: string | null; ends_at: string | null;
    project_title?: string | null; last_message_from?: string | null;
  }>;
  const projects = (projRes.data ?? []) as Array<{ status: string | null }>;

  for (const d of demands) {
    empty.demands.total++;
    if (d.status === 'open') empty.demands.open++;
    else if (d.status === 'in_progress') empty.demands.in_progress++;
    else if (d.status === 'review') empty.demands.review++;
    else if (d.status === 'done') empty.demands.done++;
  }
  for (const p of projects) {
    empty.projects.total++;
    if (p.status === 'completed') empty.projects.completed++;
    else if (p.status !== 'cancelled' && p.status !== 'canceled') empty.projects.active++;
  }
  empty.pendingRatings = Array.isArray(ratRes.data) ? ratRes.data.length : 0;

  const now = Date.now();
  const SOON = 3 * 24 * 60 * 60 * 1000; // 3 dias
  const open = (s: string | null) => s !== 'done' && s !== 'canceled';
  empty.attention = demands
    .filter((d) => open(d.status))
    .map((d): DashAttentionItem | null => {
      const due = d.ends_at ? new Date(d.ends_at).getTime() : null;
      if (d.status === 'review') return { ...d, reason: 'review' };
      if (d.last_message_from === 'team') return { ...d, reason: 'reply' };
      if (due !== null && due - now <= SOON) return { ...d, reason: 'deadline' };
      return null;
    })
    .filter((x): x is DashAttentionItem => x !== null)
    .sort((a, b) => {
      const order = { review: 0, reply: 1, deadline: 2 } as const;
      if (order[a.reason] !== order[b.reason]) return order[a.reason] - order[b.reason];
      const ad = a.ends_at ? new Date(a.ends_at).getTime() : Infinity;
      const bd = b.ends_at ? new Date(b.ends_at).getTime() : Infinity;
      return ad - bd;
    })
    .slice(0, 4);

  return empty;
}

export type PendingBriefing = { id: string; title: string; progress: number };

/**
 * Projeto mais recente com briefing AINDA NÃO enviado (rascunho) do cliente logado,
 * com o % preenchido. Usado para o aviso "continue de onde parou". null se não houver.
 */
export async function getPendingProjectBriefing(): Promise<PendingBriefing | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, title, services, briefing, briefing_status, status, created_at')
    .neq('briefing_status', 'submitted')
    .not('status', 'in', '(cancelled,completed)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  const services = Array.isArray(data.services) ? (data.services as string[]) : [];
  const briefing = (data.briefing ?? {}) as ProjectBriefing;
  let total = getGeneralFields().filter((f) => f.priority === 'red').length;
  services.forEach((svc) =>
    getProjectSections(svc).forEach((sec) =>
      sec.fields.forEach((f) => {
        if (f.priority === 'red') total++;
      }),
    ),
  );
  const { missing } = validateProjectBriefing(services, briefing);
  const progress = total ? Math.round((Math.max(0, total - missing.length) / total) * 100) : 0;

  return { id: data.id as string, title: (data.title as string) ?? 'Projeto', progress };
}
