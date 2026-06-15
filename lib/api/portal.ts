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
