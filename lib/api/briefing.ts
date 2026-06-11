// web/lib/api/briefing.ts
// Wrappers client-side (browser) sobre as RPCs/tabelas do schema portal,
// espelhando a lógica de portal/briefing-basico.html e portal/briefing.html.

import { createClient } from '@/lib/supabase/client';
import type { BriefingAnswers, ProjectBriefing } from '@/lib/briefing-templates';

export interface ClientBriefing {
  client_slug: string;
  access: Record<string, BriefingAnswers>;
  base_status: 'draft' | 'submitted';
  pending_flags: string[];
  submitted_at: string | null;
  services: string[];
}

export interface MeIdentity {
  name: string;
  email: string;
  phone: string;
}

export interface ProjectRow {
  id: string;
  title: string;
  services: string[];
  briefing: ProjectBriefing | null;
  briefing_status: string | null;
  client_slug: string;
}

/** Carrega (e garante) o Briefing Básico do cliente logado. */
export async function getClientBriefing(): Promise<ClientBriefing> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_client_briefing');
  if (error) throw error;
  const d = (data ?? {}) as Partial<ClientBriefing>;
  return {
    client_slug: d.client_slug ?? '',
    access: (d.access as Record<string, BriefingAnswers>) ?? {},
    base_status: (d.base_status as ClientBriefing['base_status']) ?? 'draft',
    pending_flags: (d.pending_flags as string[]) ?? [],
    submitted_at: d.submitted_at ?? null,
    services: (d.services as string[]) ?? [],
  };
}

/** Identificação read-only do usuário (portal.users). */
export async function getMyIdentity(): Promise<MeIdentity> {
  const supabase = createClient();
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return { name: '', email: '', phone: '' };
    const { data } = await supabase
      .from('users')
      .select('name, email, metadata')
      .eq('auth_user_id', session.user.id)
      .maybeSingle();
    const meta = (data?.metadata ?? {}) as Record<string, unknown>;
    const phone = (meta.phone as string) || (meta.telefone as string) || '';
    return { name: data?.name ?? '', email: data?.email ?? '', phone };
  } catch {
    return { name: '', email: '', phone: '' };
  }
}

/** Salva rascunho dos acessos (merge no servidor). */
export async function saveBaseBriefing(access: Record<string, BriefingAnswers>, pending: string[]): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('save_base_briefing', { p_access: access, p_pending: pending });
  if (error) throw error;
}

/** Envia o Briefing Básico (fecha o gate). */
export async function submitBaseBriefing(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('submit_base_briefing');
  if (error) throw error;
}

/** Carrega um projeto (evento) por id. */
export async function getProject(id: string): Promise<ProjectRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, title, services, briefing, briefing_status, client_slug')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as ProjectRow;
}

/** Salva rascunho do briefing de projeto (merge no servidor). */
export async function saveProjectBriefing(projectId: string, answers: ProjectBriefing): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('save_project_briefing', { p_project_id: projectId, p_answers: answers });
  if (error) throw error;
}

/** Envia o briefing de projeto. */
export async function submitProjectBriefing(projectId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('submit_project_briefing', { p_project_id: projectId });
  if (error) throw error;
}

/** JWT da sessão atual (para anexar o PDF no ClickUp). */
export async function getSessionJwt(): Promise<string | null> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
