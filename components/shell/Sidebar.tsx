'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Brand from '@/components/ui/Brand';
import UserChip from '@/components/shell/UserChip';
import type { NavItem } from '@/components/shell/Topbar';

// Ícones dos atalhos da navbar (stroke, herdam currentColor do item).
function NavIcon({ name }: { name?: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'team':
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'students':
      return (
        <svg {...common}>
          <path d="M22 10L12 5 2 10l10 5 10-5z" />
          <path d="M6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5" />
        </svg>
      );
    case 'billing':
      return (
        <svg {...common}>
          <rect x="1" y="4" width="22" height="16" rx="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
      );
    case 'projects':
      return (
        <svg {...common}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'demands':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    default:
      return null;
  }
}

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
            <NavIcon name={it.icon} />
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
