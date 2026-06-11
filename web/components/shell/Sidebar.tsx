'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Brand from '@/components/ui/Brand';
import UserChip from '@/components/shell/UserChip';
import type { NavItem } from '@/components/shell/Topbar';

export default function Sidebar({
  subtitle,
  items,
  user,
  profileHref,
}: {
  subtitle: string;
  items: NavItem[];
  user: { name: string; email: string };
  profileHref?: string;
}) {
  const pathname = usePathname();
  // raiz da área (ex.: /admin) só ativa em match exato; subrotas ativam por prefixo
  const isActive = (href: string) =>
    pathname === href || (href.split('/').length > 2 && pathname.startsWith(href + '/'));

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Brand subtitle={subtitle} />
      </div>
      <nav className="sidebar-nav">
        <span className="sidebar-section">Geral</span>
        {items.map((it) => (
          <Link key={it.href} href={it.href} className={`sidebar-item ${isActive(it.href) ? 'active' : ''}`}>
            {it.label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-foot">
        <UserChip name={user.name} email={user.email} profileHref={profileHref} />
      </div>
    </aside>
  );
}
