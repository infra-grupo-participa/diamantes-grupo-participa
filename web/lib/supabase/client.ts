import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente Supabase para Client Components (browser).
 * Usa a sessão via cookies; schema `portal` (RLS aplicada pela sessão do usuário).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: 'portal' } },
  );
}
