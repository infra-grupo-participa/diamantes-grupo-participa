'use client';

import { useEffect, useRef, useState } from 'react';
import s from './admin.module.css';
import type { EmployeeRow } from '@/lib/api/admin';
import { createEmployee, updateEmployee } from '@/lib/api/admin';
import { translateAuthError } from '@/lib/i18n';
import { toast } from '@/lib/toast';

export default function EmployeeModal({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: EmployeeRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('approved');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    setPassword('');
    if (editing) {
      setName(editing.name ?? '');
      setEmail(editing.email ?? '');
      setStatus(editing.status ?? 'approved');
    } else {
      setName('');
      setEmail('');
      setStatus('approved');
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open, editing]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (editing) {
        await updateEmployee(editing.id, { name: name.trim(), email: email.trim(), status, role: 'admin' });
        toast('Administrador atualizado.');
      } else {
        await createEmployee({ name: name.trim(), email: email.trim(), password: password.trim(), role: 'admin' });
        toast('Administrador criado.');
      }
      onSaved();
      onClose();
    } catch (ex: unknown) {
      const raw = ex as { code?: string; message?: string };
      setError(raw?.message ? translateAuthError(raw) : 'Não foi possível concluir. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={s.modalOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modalCard}>
        <div className={s.modalHead}>
          <h3>{editing ? 'Editar administrador' : 'Criar administrador'}</h3>
          <button type="button" className={s.modalClose} onClick={onClose}>
            ×
          </button>
        </div>
        <form className={s.modalForm} onSubmit={submit}>
          <div className={s.fields}>
            <div>
              <label className={s.label}>Nome completo</label>
              <input ref={nameRef} className={s.searchInput} style={{ paddingLeft: 12 }} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className={s.label}>E-mail</label>
              <input className={s.searchInput} style={{ paddingLeft: 12 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            {!editing && (
              <div>
                <label className={s.label}>Senha (mín. 8 caracteres)</label>
                <input className={s.searchInput} style={{ paddingLeft: 12 }} type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                <small className={s.hintSmall}>
                  A senha não pode ser alterada por aqui depois — peça para o usuário usar &quot;esqueci a senha&quot;.
                </small>
              </div>
            )}
            {editing && (
              <div>
                <label className={s.label}>Status</label>
                <select className={s.searchInput} style={{ paddingLeft: 12 }} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="approved">Ativo</option>
                  <option value="pending">Pendente</option>
                  <option value="disabled">Desabilitado</option>
                  <option value="rejected">Rejeitado</option>
                </select>
              </div>
            )}
          </div>
          {error && <div className={s.modalError}>{error}</div>}
          <div className={s.modalActions}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
