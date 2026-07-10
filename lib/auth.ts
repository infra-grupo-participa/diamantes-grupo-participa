import { cache } from 'react';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export type Role = 'admin' | 'user' | 'client';

export type Profile = {
  id: number;
  authUserId: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  clientSlug: string | null;
};

/**
 * Lê o perfil do usuário logado (portal.users) ou null se sem sessão.
 * Memoizado por request (React cache): layout + página no mesmo render
 * compartilham uma única validação de sessão em vez de repetir getUser+select.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
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
});

function homeFor(role: Role): string {
  if (role === 'admin') return '/admin';
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

/**
 * Guarda para Route Handlers de admin. Diferente de requireRole (que redireciona
 * páginas), retorna o perfil do admin OU um NextResponse de erro JSON pronto para
 * devolver. Uso: `const g = await assertAdminApi(); if (g instanceof NextResponse) return g;`
 */
export async function assertAdminApi(): Promise<Profile | NextResponse> {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ ok: false, error: 'Sessão expirada.' }, { status: 401 });
  if (profile.role !== 'admin' || profile.status !== 'approved') {
    return NextResponse.json({ ok: false, error: 'Permissão negada.' }, { status: 403 });
  }
  return profile;
}
