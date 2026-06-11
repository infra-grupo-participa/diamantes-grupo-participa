import { createClient } from '@/lib/supabase/server';
import LogoutButton from '@/components/logout-button';

export const metadata = { title: 'Portal — Diamantes' };

export default async function PortalHome() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main style={{ maxWidth: 760, margin: '60px auto', padding: '0 20px' }}>
      <span className="auth-badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>
        ◆ Portal do cliente
      </span>
      <h1 style={{ marginTop: 16 }}>Em migração 🚧</h1>
      <p style={{ color: 'var(--muted)' }}>
        Você está logado como <strong>{user?.email}</strong>. As telas do portal (dashboard, briefing,
        demandas, projetos, perfil) serão portadas nas próximas fases.
      </p>
      <LogoutButton />
    </main>
  );
}
