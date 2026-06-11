'use client';

import { useState } from 'react';
import { submitOperatorRating } from '@/lib/api/operator';
import { toast } from '@/lib/toast';
import s from './demandas.module.css';

const DIMS: { key: string; label: string }[] = [
  { key: 'communication', label: 'Comunicação' },
  { key: 'clarity', label: 'Clareza do briefing' },
  { key: 'payment_punctuality', label: 'Pontualidade no pagamento' },
];

export default function OperatorRatingModal({
  demandId,
  clientName,
  demandTitle,
  onClose,
  onDone,
}: {
  demandId: string;
  clientName: string;
  demandTitle: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [score, setScore] = useState<number | null>(null);
  const [dims, setDims] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (score == null) return;
    setSubmitting(true);
    try {
      await submitOperatorRating(demandId, score, comment.trim() || null, dims);
      onDone();
      onClose();
    } catch (e) {
      toast('Erro ao enviar avaliação: ' + ((e as Error).message || e), 'error');
      setSubmitting(false);
    }
  }

  return (
    <div className={s.modalBackdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.modalCard}>
        <div className={s.modalHead}>
          <h3>Avaliar cliente</h3>
          <div className={s.sub}>
            {clientName} • {demandTitle}
          </div>
        </div>
        <div className={s.modalBody}>
          <label className={s.modalLabel}>Nota geral (1 a 5)</label>
          <div className={s.scoreRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`${s.scoreBtn} ${score === n ? s.on : ''}`}
                onClick={() => setScore(n)}
              >
                {n}
              </button>
            ))}
          </div>
          {DIMS.map((dm) => (
            <div key={dm.key}>
              <label className={s.modalLabelSm}>{dm.label}</label>
              <div className={s.dimRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`${s.dimBtn} ${dims[dm.key] === n ? s.on : ''}`}
                    onClick={() => setDims((prev) => ({ ...prev, [dm.key]: n }))}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <label className={s.modalLabel} style={{ margin: '14px 0 4px' }}>
            Comentário (opcional)
          </label>
          <textarea
            className={s.modalComment}
            rows={3}
            placeholder="O que destacaria sobre esse cliente?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className={s.modalActions}>
            <button type="button" className={s.modalCancel} onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className={s.modalSubmit} disabled={score == null || submitting} onClick={submit}>
              {submitting ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
