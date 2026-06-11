'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { initials } from '@/lib/format';

type Props = {
  name: string;
  email: string;
  profileHref?: string; // ex.: /portal/perfil ou /operator/perfil (admin não tem)
};

export default function UserChip({ name, email, profileHref }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  async function logout() {
    if (!confirm('Deseja sair da sua conta?')) return;
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="user-chip" ref={ref}>
      <button className="user-chip-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="avatar-sm">{initials(name)}</span>
        <span className="user-chip-name">{name || 'Você'}</span>
        <span className="chev" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="user-menu" role="menu">
          <div className="user-menu-head">
            <strong>{name || 'Você'}</strong>
            <span>{email}</span>
          </div>
          {profileHref && (
            <Link className="user-menu-item" href={profileHref} onClick={() => setOpen(false)}>
              Meus dados
            </Link>
          )}
          <button className="user-menu-item danger" onClick={logout}>
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
