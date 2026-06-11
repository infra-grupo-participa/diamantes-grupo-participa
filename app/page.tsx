import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Raiz: roteia por sessão/role.
 * - sem sessão → /login
 * - admin → /admin ; cliente → /portal
 */
export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  redirect(profile?.role === 'admin' ? '/admin' : '/portal');
}
