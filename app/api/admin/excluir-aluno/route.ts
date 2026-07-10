import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { assertAdminApi } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exclui o aluno por completo: login (auth.users) + perfil (portal.users, inclusive
 * aliases de matching Hotmart) + cliente (clients, que cascateia profiles/serviços).
 *
 * Corrige o fluxo antigo, que só apagava `clients` e deixava o login órfão em
 * `portal.users`/`auth.users`. Precisa da service-role para remover o auth user.
 */
const SLUG_RE = /^[a-z0-9-]+$/;

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const guard = await assertAdminApi();
  if (guard instanceof NextResponse) return guard;

  const { slug } = (await request.json().catch(() => ({}))) as { slug?: string };
  if (!slug || !SLUG_RE.test(slug)) return fail('Aluno (slug) inválido.', 400);

  const admin = createAdminClient();

  // Todas as linhas de portal.users do slug (login real + aliases).
  const { data: rows } = await admin
    .from('users')
    .select('id, auth_user_id')
    .eq('client_slug', slug)
    .eq('role', 'user');

  // Remove os auth users (só os que têm login de verdade).
  for (const r of (rows ?? []) as Array<{ id: string; auth_user_id: string | null }>) {
    if (r.auth_user_id) {
      const { error } = await admin.auth.admin.deleteUser(r.auth_user_id);
      // 404 = já não existe no Auth; segue para não travar a exclusão do cliente.
      if (error && !/not.?found|user_not_found/i.test(error.message)) {
        return fail('Falha ao remover o login do aluno: ' + error.message, 502);
      }
    }
  }

  // Remove as linhas de perfil (o delete do auth user pode não cascatear portal.users).
  await admin.from('users').delete().eq('client_slug', slug).eq('role', 'user');

  // Por fim o cliente (cascateia client_profiles, serviços, ratings, team_assignments).
  const { error: cliErr } = await admin.from('clients').delete().eq('slug', slug);
  if (cliErr) return fail('Falha ao excluir o cliente: ' + cliErr.message, 500);

  return NextResponse.json({ ok: true });
}
