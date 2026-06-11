import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase/config';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Cliente Supabase para Server Components / Server Actions / Route Handlers.
 * Lê/escreve a sessão nos cookies da request; schema `portal`.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      db: { schema: 'portal' },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component: set() não permitido fora de Action/Route — ok, o middleware renova.
          }
        },
      },
    },
  );
}

/**
 * Cliente com service-role (somente servidor — NUNCA em Client Components).
 * Bypassa RLS; usar só em Route Handlers/Server Actions controlados.
 */
export function createAdminClient() {
  return createServerClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE!, {
    db: { schema: 'portal' },
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
