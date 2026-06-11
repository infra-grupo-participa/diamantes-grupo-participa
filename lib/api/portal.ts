import { createClient } from '@/lib/supabase/server';

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
