import { requireRole } from '@/lib/auth';
import Sidebar from '@/components/shell/Sidebar';
import type { NavItem } from '@/components/shell/Topbar';

const NAV: NavItem[] = [
  { href: '/admin', label: 'Equipe', icon: 'team' },
  { href: '/admin/alunos', label: 'Alunos Diamantes', icon: 'students' },
  { href: '/admin/assinaturas', label: 'Assinaturas', icon: 'billing' },
  { href: '/admin/projetos', label: 'Projetos', icon: 'projects' },
  { href: '/admin/demandas', label: 'Demandas', icon: 'demands' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const p = await requireRole(['admin']);
  return (
    <div className="app-admin">
      <Sidebar subtitle="Admin" items={NAV} user={{ name: p.name, email: p.email }} />
      <main className="app-main admin-main">{children}</main>
    </div>
  );
}
