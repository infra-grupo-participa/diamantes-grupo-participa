import { requireRole } from '@/lib/auth';
import Topbar, { type NavItem } from '@/components/shell/Topbar';

const NAV: NavItem[] = [
  { href: '/portal', label: 'Início' },
  { href: '/portal/demandas', label: 'Demandas' },
  { href: '/portal/projetos', label: 'Projetos' },
  { href: '/portal/perfil', label: 'Meus dados' },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const p = await requireRole(['user', 'client']);
  return (
    <div className="app-portal">
      <Topbar items={NAV} user={{ name: p.name, email: p.email }} profileHref="/portal/perfil" />
      <main className="app-main">{children}</main>
    </div>
  );
}
