'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Error boundary da área do cliente. Evita o white-screen ("server-side exception"):
 * qualquer erro de render numa página do portal cai aqui, dentro do shell.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log no console do navegador/servidor para diagnóstico.
    console.error('[portal] erro de página:', error);
  }, [error]);

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '8vh auto',
        padding: '32px 28px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl, 16px)',
        boxShadow: 'var(--shadow-md)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          margin: '0 auto 16px',
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--danger-soft)',
          color: 'var(--danger-strong)',
        }}
        aria-hidden
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      </div>
      <h1 style={{ fontSize: '1.3rem', margin: '0 0 8px', color: 'var(--text)' }}>
        Algo deu errado nesta tela
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: '0.95rem', lineHeight: 1.5, margin: '0 0 20px' }}>
        Tivemos um problema ao carregar esta página. Você pode tentar de novo ou voltar ao início.
        {error?.digest && (
          <>
            <br />
            <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>Código: {error.digest}</span>
          </>
        )}
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button className="btn-primary" type="button" onClick={() => reset()} style={{ width: 'auto' }}>
          Tentar de novo
        </button>
        <Link
          href="/portal"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '13px 20px',
            borderRadius: 12,
            fontWeight: 600,
            fontSize: '0.95rem',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            textDecoration: 'none',
          }}
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
