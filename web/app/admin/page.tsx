import { createClient } from '@/lib/supabase/server';
import LogoutButton from '@/components/logout-button';

export const metadata = { title: 'Admin — Diamantes' };

export default async function AdminHome() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main style={{ maxWidth: 760, margin: '60px auto', padding: '0 20px' }}>
      <span className="auth-badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>
        ◆ Painel interno
      </span>
      <h1 style={{ marginTop: 16 }}>Em migração 🚧</h1>
      <p style={{ color: 'var(--muted)' }}>
        Logado como <strong>{user?.email}</strong>. Os painéis admin (funcionários, alunos, assinaturas,
        projetos, demandas) serão portados nas próximas fases.
      </p>
      <LogoutButton />
    </main>
  );
}
