// Camada de dados do Perfil do cliente — porta fiel das funções de
// portal-api.js: getMe, updateMe (só name + merge metadata), getPreferences,
// setPreferences (upsert onConflict user_id), changePassword (>=8),
// uploadAvatar / removeAvatar (bucket 'avatars', <=2MB).
//
// Tudo via createClient() do browser (RLS protege pela sessão).

import { createClient } from '@/lib/supabase/client';

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────

export interface ProfileMetadata {
  phone?: string;
  job_role?: string;
  company?: string;
  location?: string;
  bio?: string;
  avatar_url?: string | null;
  [key: string]: unknown;
}

export interface MeProfile {
  id: number;
  name: string | null;
  email: string | null;
  client_slug: string | null;
  metadata: ProfileMetadata | null;
  created_at?: string | null;
  last_login_at?: string | null;
}

export interface UserPreferences {
  user_id?: number;
  notify_messages: boolean;
  notify_demand_update: boolean;
  notify_deadlines: boolean;
  notify_weekly_digest: boolean;
  notify_news: boolean;
  language: string;
  timezone: string;
  theme: string;
  updated_at?: string;
}

export const DEFAULT_PREFS: UserPreferences = {
  notify_messages: true,
  notify_demand_update: true,
  notify_deadlines: true,
  notify_weekly_digest: false,
  notify_news: false,
  language: 'pt-BR',
  timezone: 'America/Sao_Paulo',
  theme: 'light',
};

// ─────────────────────────────────────────────────────────────
// Me / update
// ─────────────────────────────────────────────────────────────

export async function getMe(): Promise<MeProfile | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, client_slug, metadata, created_at, last_login_at')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as MeProfile | null;
}

/** Atualiza apenas `name` e mescla `metadata` (igual ao legado). */
export async function updateMe(patch: {
  name?: string;
  metadata?: Partial<ProfileMetadata>;
}): Promise<MeProfile> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada.');

  const clean: Record<string, unknown> = {};
  if (patch.name !== undefined) clean.name = patch.name;

  if (patch.metadata && typeof patch.metadata === 'object') {
    const { data: current } = await supabase
      .from('users')
      .select('metadata')
      .eq('auth_user_id', session.user.id)
      .maybeSingle();
    clean.metadata = Object.assign({}, (current?.metadata as object) || {}, patch.metadata);
  }
  clean.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('users')
    .update(clean)
    .eq('auth_user_id', session.user.id)
    .select()
    .single();
  if (error) throw error;
  return data as MeProfile;
}

// ─────────────────────────────────────────────────────────────
// Preferências
// ─────────────────────────────────────────────────────────────

export async function getPreferences(): Promise<UserPreferences> {
  const me = await getMe();
  if (!me) throw new Error('Sessão expirada.');
  const supabase = createClient();
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', me.id)
    .maybeSingle();
  if (error) throw error;
  return (data as UserPreferences) ?? { user_id: me.id, ...DEFAULT_PREFS };
}

export async function setPreferences(patch: Partial<UserPreferences>): Promise<UserPreferences> {
  const me = await getMe();
  if (!me) throw new Error('Sessão expirada.');
  const allowed = Object.keys(DEFAULT_PREFS) as (keyof UserPreferences)[];
  const clean: Record<string, unknown> = {
    user_id: me.id,
    updated_at: new Date().toISOString(),
  };
  for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
  const supabase = createClient();
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert(clean, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return data as UserPreferences;
}

// ─────────────────────────────────────────────────────────────
// Senha
// ─────────────────────────────────────────────────────────────

export async function changePassword(newPassword: string): Promise<true> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('A senha precisa ter no mínimo 8 caracteres.');
  }
  const { error } = await createClient().auth.updateUser({ password: newPassword });
  if (error) throw error;
  return true;
}

// ─────────────────────────────────────────────────────────────
// Avatar (Storage bucket 'avatars')
// ─────────────────────────────────────────────────────────────

export async function uploadAvatar(file: File): Promise<string> {
  if (!file) throw new Error('Selecione um arquivo.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Arquivo maior que 2 MB.');
  const supabase = createClient();
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

export async function removeAvatar(): Promise<void> {
  const supabase = createClient();
  const me = await getMe();
  if (!me) throw new Error('Sessão expirada.');
  const currentUrl = me.metadata?.avatar_url;
  if (currentUrl) {
    const m = currentUrl.match(/\/avatars\/(.+)$/);
    if (m) {
      try {
        await supabase.storage.from('avatars').remove([m[1]]);
      } catch {
        /* best-effort */
      }
    }
  }
  await updateMe({ metadata: { avatar_url: null } });
}
