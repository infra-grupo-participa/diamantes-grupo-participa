import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase/config';

/**
 * Cliente Supabase para Client Components (browser).
 * Usa a sessão via cookies; schema `portal` (RLS aplicada pela sessão do usuário).
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: 'portal' } });
}
