'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

/**
 * Define a nova senha usando a sessão de recuperação estabelecida pelo link
 * (via /auth/callback). Sem sessão válida, o updateUser falha e orientamos
 * o usuário a pedir um novo link.
 */
export default function UpdateForm() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (password.length < 8) return setErro('A senha precisa ter ao menos 8 caracteres.');
    if (password !== confirm) return setErro('As senhas não conferem.');

    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErro(
          /session|jwt|missing/i.test(error.message)
            ? 'Sua sessão de redefinição expirou. Solicite um novo link.'
            : error.message,
        );
        setLoading(false);
        return;
      }
      setOk(true);
    } catch {
      setErro('Não foi possível redefinir. Tente novamente.');
      setLoading(false);
    }
  }

  if (ok) {
    return (
      <div>
        <div
          className="auth-error"
          style={{ background: 'rgba(22,163,74,0.08)', color: 'var(--success)', borderColor: 'rgba(22,163,74,0.25)' }}
        >
          Senha redefinida com sucesso.
        </div>
        <Link className="btn-primary" href="/login" style={{ display: 'inline-block', textAlign: 'center' }}>
          Ir para o login
        </Link>
      </div>
    );
  }

  if (hasSession === false) {
    return (
      <div>
        <div className="auth-error">
          Link inválido ou expirado. Abra o link mais recente do seu e-mail ou solicite um novo.
        </div>
        <Link className="btn-primary" href="/reset-password" style={{ display: 'inline-block', textAlign: 'center' }}>
          Solicitar novo link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      {erro && <div className="auth-error">{erro}</div>}

      <div className="field">
        <label htmlFor="password">Nova senha</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          placeholder="mínimo 8 caracteres"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="confirm">Confirmar nova senha</label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          placeholder="repita a senha"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>

      <button className="btn-primary" type="submit" disabled={loading || hasSession === null}>
        {loading ? 'Redefinindo…' : 'Redefinir senha'}
      </button>
    </form>
  );
}
