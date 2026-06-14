'use client';

// Modal de avaliação cliente → operadores (nota 1-10 + comentário).
// Port do openRatingModal() de portal/demandas.html — RPC submit_client_rating.

import { useState } from 'react';
import { submitClientRating } from '@/lib/api/demandas';
import { toast } from '@/lib/toast';
import styles from './Modal.module.css';

const STAR = '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2';
const HINTS = ['', 'Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente'];

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
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const shown = hover || score;

  async function submit() {
    if (score < 1) return;
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
            <h3>Avalie essa entrega</h3>
            <div className={styles.headSub}>{demandTitle}</div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className={styles.body}>
          <label className={styles.label}>Sua nota</label>
          <div className={styles.starsRow} onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`${styles.starBtn} ${n <= shown ? styles.starOn : ''}`}
                onMouseEnter={() => setHover(n)}
                onClick={() => setScore(n)}
                aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
              >
                <svg viewBox="0 0 24 24" fill={n <= shown ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
                  <polygon points={STAR} />
                </svg>
              </button>
            ))}
          </div>
          <div className={styles.starHint}>{HINTS[shown] || 'Toque nas estrelas para avaliar'}</div>
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
            <button type="button" className={styles.btnPrimary} onClick={() => void submit()} disabled={score < 1 || busy}>
              {busy ? 'Enviando…' : 'Enviar avaliação'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
