import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type Role = 'admin' | 'user' | 'operator' | 'client';

export type Profile = {
  id: number;
  authUserId: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  clientSlug: string | null;
};

/** Lê o perfil do usuário logado (portal.users) ou null se sem sessão. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('users')
    .select('id, auth_user_id, name, email, role, status, client_slug')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    authUserId: data.auth_user_id,
    name: data.name,
    email: data.email,
    role: data.role,
    status: data.status,
    clientSlug: data.client_slug,
  };
}

function homeFor(role: Role): string {
  if (role === 'admin') return '/admin';
  if (role === 'operator') return '/operator';
  return '/portal';
}

/** Guard de área: exige sessão + status approved + role permitido; senão redireciona. */
export async function requireRole(roles: Role[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect('/login');
  if (profile.status !== 'approved') redirect('/login');
  if (!roles.includes(profile.role)) redirect(homeFor(profile.role));
  return profile;
}
