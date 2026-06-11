// Camada de dados de Projetos (evento multi-serviço) — porta fiel do
// portal-api.js (listMyProjects, getProject, createProject) + perfil.
//
// Funções "browser" usam createClient() (RLS pela sessão do usuário). Há
// também getClientBriefingBrowser para o gate de novo-projeto sem RSC.

import { createClient } from '@/lib/supabase/client';
import type { ProjectBriefing } from '@/lib/briefing-templates';

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────

export type ProjectStatus = 'briefing' | 'active' | 'completed' | 'cancelled';
export type BriefingStatus = 'draft' | 'submitted';

export interface Project {
  id: string;
  title: string;
  services: string[] | null;
  briefing: ProjectBriefing | null;
  briefing_status: BriefingStatus | string;
  status: ProjectStatus | string;
  created_at: string;
  updated_at?: string;
  client_slug?: string;
}

export interface ClientBriefingInfo {
  client_slug?: string;
  access?: Record<string, unknown>;
  base_status?: string;
  pending_flags?: unknown[];
  submitted_at?: string | null;
  services?: string[];
}

// ─────────────────────────────────────────────────────────────
// Projetos
// ─────────────────────────────────────────────────────────────

/** Lista os projetos do cliente logado (RLS restringe ao próprio slug). */
export async function listMyProjects(): Promise<Project[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, title, services, briefing, briefing_status, status, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Project[];
}

export async function getProject(id: string): Promise<Project | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, title, services, briefing, briefing_status, status, client_slug, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Project | null;
}

/** Cria projeto (evento). Retorna o registro criado (com id). */
export async function createProject(input: {
  title: string;
  general?: Record<string, unknown>;
  services?: string[];
}): Promise<Project> {
  const title = (input.title || '').trim();
  if (!title) throw new Error('Título obrigatório.');
  const supabase = createClient();
  const { data, error } = await supabase.rpc('create_project', {
    p_title: title,
    p_general: input.general ?? {},
    p_services: input.services ?? [],
  });
  if (error || !data) {
    throw new Error((error && error.message) || 'Não foi possível criar o projeto.');
  }
  return data as Project;
}

// ─────────────────────────────────────────────────────────────
// Briefing Básico (gate) — versão browser para o novo-projeto
// ─────────────────────────────────────────────────────────────

export async function getClientBriefingBrowser(): Promise<ClientBriefingInfo | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_client_briefing');
  if (error) throw error;
  return (data ?? null) as ClientBriefingInfo | null;
}
