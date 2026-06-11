import { requireRole } from '@/lib/auth';
import Sidebar from '@/components/shell/Sidebar';
import type { NavItem } from '@/components/shell/Topbar';

const NAV: NavItem[] = [
  { href: '/operator', label: 'Início' },
  { href: '/operator/demandas', label: 'Demandas' },
  { href: '/operator/perfil', label: 'Meu perfil' },
];

export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const p = await requireRole(['operator']);
  return (
    <div className="app-admin">
      <Sidebar
        subtitle="Operador"
        items={NAV}
        user={{ name: p.name, email: p.email }}
        profileHref="/operator/perfil"
      />
      <main className="app-main admin-main">{children}</main>
    </div>
  );
}
