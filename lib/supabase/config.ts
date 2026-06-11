// URL + anon key são PÚBLICOS (vão pro browser de qualquer forma). O fallback embutido
// garante o client mesmo quando as env NEXT_PUBLIC_* não estão presentes no momento do
// build (ex.: Hostinger Node App injeta env só em runtime, e NEXT_PUBLIC_* precisa do build).
// Secrets (service-role, ClickUp, Hotmart) NUNCA têm fallback — só via env do servidor.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://npqyvjhvtfahuxfmuhie.supabase.co';

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wcXl2amh2dGZhaHV4Zm11aGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzM3NTksImV4cCI6MjA5MzgwOTc1OX0.-CjnE6iaT7M1UETFiXeUG6FQ6YugTcFrKGMjt89_4Q0';
