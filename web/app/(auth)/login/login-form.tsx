'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/** Traduz os erros mais comuns do Supabase Auth (porta de supabase-i18n.js). */
function traduzErro(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'E-mail ainda não confirmado.';
  if (m.includes('rate limit')) return 'Muitas tentativas. Aguarde um instante.';
  return 'Não foi possível entrar. Tente novamente.';
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setLoading(true);
    const supabase = createClient();

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setErro(traduzErro(error?.message ?? ''));
      setLoading(false);
      return;
    }

    // resolve role p/ redirecionar (RLS permite ler o próprio registro)
    const { data: profile } = await supabase
      .from('users')
      .select('role, status')
      .eq('auth_user_id', data.user.id)
      .maybeSingle();

    if (profile?.status && profile.status !== 'approved') {
      setErro('Sua conta ainda não foi aprovada.');
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    router.replace(profile?.role === 'admin' ? '/admin' : '/portal');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      {erro && <div className="auth-error">{erro}</div>}

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

      <div className="field">
        <label htmlFor="password">Senha</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <button className="btn-primary" type="submit" disabled={loading}>
        {loading ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
