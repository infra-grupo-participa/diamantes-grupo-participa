'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

/**
 * Solicitação de redefinição (seguro): a rota /api/auth/reset-password gera o link
 * e o envia pelo Resend. Não revela se o e-mail existe (anti-enumeração) — sempre
 * mostra sucesso.
 */
export default function ResetForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const linkErro = params.get('erro') === 'link';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
    } catch {
      // Silencioso de propósito (não vaza existência do e-mail).
    } finally {
      setLoading(false);
      setOk(true);
    }
  }

  if (ok) {
    return (
      <div>
        <div
          className="auth-error"
          role="status"
          aria-live="polite"
          style={{ background: 'rgba(22,163,74,0.08)', color: 'var(--success)', borderColor: 'rgba(22,163,74,0.25)' }}
        >
          Se houver uma conta com esse e-mail, enviamos um link para redefinir a senha. Verifique sua caixa de entrada (e o spam).
        </div>
        <Link className="btn-primary" href="/login" style={{ display: 'inline-block', textAlign: 'center' }}>
          Voltar ao login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      {linkErro && (
        <div className="auth-error" role="alert" aria-live="assertive">
          O link expirou ou já foi usado. Solicite um novo abaixo.
        </div>
      )}

      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          placeholder="seuemail@dominio.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <button className="btn-primary" type="submit" disabled={loading}>
        {loading ? 'Enviando…' : 'Enviar link de redefinição'}
      </button>
      <p style={{ marginTop: 14, fontSize: '0.85rem' }}>
        <Link href="/login">← Voltar ao login</Link>
      </p>
    </form>
  );
}
