'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { translateAuthError } from '@/lib/i18n';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setLoading(true);
    const supabase = createClient();

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setErro(translateAuthError(error));
      setLoading(false);
      return;
    }

    // resolve role p/ redirecionar (RLS permite ler o próprio registro)
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('role, status')
      .eq('auth_user_id', data.user.id)
      .maybeSingle();

    if (profileError) {
      setErro('Não foi possível carregar seu perfil. Tente novamente.');
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    if (!profile) {
      setErro('Não encontramos seu perfil. Fale com o suporte.');
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    if (profile.status !== 'approved') {
      setErro('Sua conta ainda não foi aprovada.');
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    // Carimba o último acesso (alimenta o KPI "Ativos hoje"); não bloqueia o login.
    try {
      await supabase.rpc('touch_my_last_login');
    } catch {
      /* noop */
    }

    router.replace(profile.role === 'admin' ? '/admin' : '/portal');
    router.refresh();
    setLoading(false);
  }

  return (
    <form onSubmit={onSubmit}>
      {erro && (
        <div className="auth-error" role="alert" aria-live="assertive">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          <span>{erro}</span>
        </div>
      )}

      <div className="field">
        <label htmlFor="email">E-mail</label>
        <div className="input-wrap">
          <span className="input-ico" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
          </span>
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
      </div>

      <div className="field">
        <label htmlFor="password">Senha</label>
        <div className="input-wrap">
          <span className="input-ico" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </span>
          <input
            id="password"
            type={showPw ? 'text' : 'password'}
            className="has-toggle"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            className="input-toggle"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {showPw ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <path d="M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.1 9.1 0 0 0 5.39-1.61" />
                <path d="m2 2 20 20" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <button className="btn-primary" type="submit" disabled={loading}>
        {loading ? (
          'Entrando…'
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
            Entrar
          </>
        )}
      </button>

      <div className="auth-or">ou</div>
      <p className="auth-forgot">
        <Link href="/reset-password">Esqueci minha senha</Link>
      </p>
    </form>
  );
}
