'use client';

import { useEffect, useRef, useState } from 'react';
import s from './admin.module.css';
import type { OperatorRow, Position } from '@/lib/api/admin';
import { createOperator, updateOperator } from '@/lib/api/admin';
import { toast } from '@/lib/toast';

export default function OperatorModal({
  open,
  editing,
  positions,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: OperatorRow | null;
  positions: Position[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [positionId, setPositionId] = useState('');
  const [clickupId, setClickupId] = useState('');
  const [status, setStatus] = useState('active');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setName(editing.name ?? '');
      setEmail(editing.email ?? '');
      setPositionId(editing.position_id ?? '');
      setClickupId(editing.clickup_user_id ?? '');
      setStatus(editing.status ?? 'active');
    } else {
      setName('');
      setEmail('');
      setPositionId('');
      setClickupId('');
      setStatus('active');
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open, editing]);

  // Esc fecha o modal (consistência com os demais modais admin).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        email: email.trim() || null,
        position_id: positionId || null,
        clickup_user_id: clickupId.trim() || null,
      };
      if (editing) {
        await updateOperator(editing.id, { ...payload, status });
        toast('Operador atualizado.');
      } else {
        await createOperator(payload);
        toast('Operador criado.');
      }
      onSaved();
      onClose();
    } catch (ex: unknown) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={s.modalOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modalCard}>
        <div className={s.modalHead}>
          <h3>{editing ? 'Editar operador' : 'Novo operador'}</h3>
          <button type="button" className={s.modalClose} onClick={onClose}>
            ×
          </button>
        </div>
        <form className={s.modalForm} onSubmit={submit}>
          <p className={s.infoBox}>Operadores não têm senha nem acesso ao portal — atuam exclusivamente no ClickUp.</p>
          <div className={s.fields}>
            <div>
              <label className={s.label}>Nome completo</label>
              <input ref={nameRef} className={s.searchInput} style={{ paddingLeft: 12 }} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className={s.label}>E-mail (opcional)</label>
              <input className={s.searchInput} style={{ paddingLeft: 12 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className={s.fieldGrid2}>
              <div>
                <label className={s.label}>Cargo</label>
                <select className={s.searchInput} style={{ paddingLeft: 12 }} value={positionId} onChange={(e) => setPositionId(e.target.value)}>
                  <option value="">— sem cargo —</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={s.label}>ClickUp User ID</label>
                <input className={s.searchInput} style={{ paddingLeft: 12 }} value={clickupId} onChange={(e) => setClickupId(e.target.value)} placeholder="ex.: 12345678" />
              </div>
            </div>
            {editing && (
              <div>
                <label className={s.label}>Status</label>
                <select className={s.searchInput} style={{ paddingLeft: 12 }} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                  <option value="suspended">Suspenso</option>
                </select>
              </div>
            )}
          </div>
          {error && <div className={s.modalError}>{error}</div>}
          <div className={s.modalActions}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className={`btn-primary ${s.btnOp}`} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
