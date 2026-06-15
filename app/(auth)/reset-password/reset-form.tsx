'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

/**
 * Solicitação de redefinição (seguro): envia um link por e-mail via Supabase Auth.
 * Não revela se o e-mail existe (anti-enumeração) — sempre mostra sucesso.
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
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password/update`;
      await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
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
