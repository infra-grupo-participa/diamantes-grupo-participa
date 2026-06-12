'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ResetForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (password.length < 8) return setErro('A senha precisa ter ao menos 8 caracteres.');
    if (password !== confirm) return setErro('As senhas não conferem.');

    setLoading(true);
    try {
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await res.json();
      if (!d.ok) {
        setErro(d.error || 'Não foi possível redefinir.');
        setLoading(false);
        return;
      }
      setOk(true);
    } catch {
      setErro('Falha de conexão. Tente novamente.');
      setLoading(false);
    }
  }

  if (ok) {
    return (
      <div>
        <div className="auth-error" style={{ background: 'rgba(22,163,74,0.08)', color: 'var(--success)', borderColor: 'rgba(22,163,74,0.25)' }}>
          Senha redefinida com sucesso.
        </div>
        <Link className="btn-primary" href="/login" style={{ display: 'inline-block', textAlign: 'center' }}>
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      {erro && <div className="auth-error">{erro}</div>}

      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input id="email" type="email" autoComplete="username" placeholder="seuemail@dominio.com"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="password">Nova senha</label>
        <input id="password" type="password" autoComplete="new-password" placeholder="mínimo 8 caracteres"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="confirm">Confirmar nova senha</label>
        <input id="confirm" type="password" autoComplete="new-password" placeholder="repita a senha"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>

      <button className="btn-primary" type="submit" disabled={loading}>
        {loading ? 'Redefinindo…' : 'Redefinir senha'}
      </button>
      <p style={{ marginTop: 14, fontSize: '0.85rem' }}>
        <Link href="/login">← Voltar ao login</Link>
      </p>
    </form>
  );
}
