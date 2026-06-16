'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Brand from '@/components/ui/Brand';
import UserChip from '@/components/shell/UserChip';

export type NavItem = { href: string; label: string; icon?: string };

export default function Topbar({
  items,
  user,
  profileHref,
}: {
  items: NavItem[];
  user: { name: string; email: string };
  profileHref?: string;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || (href.split('/').length > 2 && pathname.startsWith(href + '/'));

  return (
    <header className="topbar">
      <Link href="/portal" className="topbar-brand">
        <Brand />
      </Link>
      <nav className="topnav">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className={`topnav-item ${isActive(it.href) ? 'active' : ''}`}>
            {it.label}
          </Link>
        ))}
      </nav>
      <UserChip name={user.name} email={user.email} profileHref={profileHref} />
    </header>
  );
}
