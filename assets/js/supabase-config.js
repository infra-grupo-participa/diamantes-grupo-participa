// Supabase config global — single source of truth pra credentials públicas.
// Cuidado: SUPABASE_URL + ANON_KEY são públicas (RLS protege os dados);
// service_role key NUNCA pode aparecer aqui — só no server-side.
window.SUPABASE_CONFIG = {
  url: 'https://npqyvjhvtfahuxfmuhie.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wcXl2amh2dGZhaHV4Zm11aGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzM3NTksImV4cCI6MjA5MzgwOTc1OX0.-CjnE6iaT7M1UETFiXeUG6FQ6YugTcFrKGMjt89_4Q0',
  schema: 'portal',
};

window.getSupabaseClient = function () {
  if (window.__supabaseClient) return window.__supabaseClient;
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('@supabase/supabase-js não carregado — adicione o <script src="...supabase.min.js"> antes deste arquivo');
  }
  // No-op lock: evita deadlock do navigator.locks quando callbacks de
  // onAuthStateChange chamam métodos do supabase (re-entrada). Aceitável
  // single-tab; em multi-tab pode haver corrida no refresh do token.
  const noopLock = (_name, _timeout, fn) => fn();
  window.__supabaseClient = window.supabase.createClient(
    window.SUPABASE_CONFIG.url,
    window.SUPABASE_CONFIG.anonKey,
    {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'gp-portal-auth', lock: noopLock },
      db: { schema: window.SUPABASE_CONFIG.schema },
      global: { headers: { 'X-Client-Info': 'diamantes-portal/2.0' } },
    }
  );
  return window.__supabaseClient;
};
