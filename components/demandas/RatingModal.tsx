'use client';

// Modal de avaliação cliente → operadores (nota 1-10 + comentário).
// Port do openRatingModal() de portal/demandas.html — RPC submit_client_rating.

import { useState } from 'react';
import { submitClientRating } from '@/lib/api/demandas';
import { toast } from '@/lib/toast';
import styles from './Modal.module.css';

export default function RatingModal({
  demandId,
  demandTitle,
  onClose,
  onSubmitted,
}: {
  demandId: string;
  demandTitle: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (score == null) return;
    setBusy(true);
    try {
      await submitClientRating(demandId, score, comment.trim());
      toast('Avaliação enviada. Obrigado!', 'success');
      onSubmitted();
    } catch (e) {
      toast('Erro ao enviar avaliação: ' + (e instanceof Error ? e.message : String(e)), 'error');
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.dialog} ${styles.narrow}`}>
        <div className={styles.head}>
          <div>
            <h3>Avalie essa demanda</h3>
            <div className={styles.headSub}>{demandTitle}</div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className={styles.body}>
          <label className={styles.label}>Sua nota (1 a 10)</label>
          <div className={styles.scoreRow}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                type="button"
                className={`${styles.scoreBtn} ${score === n ? styles.active : ''}`}
                onClick={() => setScore(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <label className={styles.label}>
            Comentário <span className={styles.opt}>(opcional)</span>
          </label>
          <textarea
            className={styles.textarea}
            rows={3}
            placeholder="Conte como foi sua experiência…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className={styles.actions}>
            <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className={styles.btnPrimary} onClick={() => void submit()} disabled={score == null || busy}>
              {busy ? 'Enviando…' : 'Enviar avaliação'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
