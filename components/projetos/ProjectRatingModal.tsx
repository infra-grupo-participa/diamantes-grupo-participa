'use client';

// Modal de avaliação de PROJETO (CSAT 5 estrelas + comentário + NPS opcional).
// RPC submit_project_rating (migration 036).

import { useEffect, useRef, useState } from 'react';
import { submitProjectRating } from '@/lib/api/projects';
import { toast } from '@/lib/toast';
import s from './projetoRating.module.css';

const STAR = '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2';
const HINTS = ['', 'Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente'];

export default function ProjectRatingModal({
  projectId,
  projectTitle,
  onClose,
  onSubmitted,
}: {
  projectId: string;
  projectTitle: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [nps, setNps] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const shown = hover || stars;

  // a11y: fecha no Esc e foca o modal ao abrir.
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function submit() {
    if (stars < 1) return;
    setBusy(true);
    try {
      await submitProjectRating({ projectId, stars, comment, nps });
      toast('Avaliação enviada. Obrigado pelo feedback!', 'success');
      onSubmitted();
    } catch (e) {
      toast('Erro ao enviar avaliação: ' + (e instanceof Error ? e.message : String(e)), 'error');
      setBusy(false);
    }
  }

  return (
    <div className={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-label="Como foi o projeto?" tabIndex={-1} ref={dialogRef}>
        <div className={s.head}>
          <h3>Como foi o projeto?</h3>
          <div className={s.headSub}>{projectTitle}</div>
          <button type="button" className={s.closeBtn} onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className={s.body}>
          <div className={s.stars} onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`${s.star} ${n <= shown ? s.on : ''}`}
                onMouseEnter={() => setHover(n)}
                onClick={() => setStars(n)}
                aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
              >
                <svg viewBox="0 0 24 24" fill={n <= shown ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
                  <polygon points={STAR} />
                </svg>
              </button>
            ))}
          </div>
          <div className={s.starHint}>{HINTS[shown] || 'Toque nas estrelas para avaliar'}</div>

          <label className={s.label}>
            Comentário <span className={s.opt}>(opcional)</span>
          </label>
          <textarea
            className={s.textarea}
            rows={3}
            placeholder="O que funcionou bem? O que poderia melhorar?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />

          <label className={s.label}>
            De 0 a 10, o quanto recomendaria a Diamantes? <span className={s.opt}>(opcional)</span>
          </label>
          <div className={s.npsRow}>
            {Array.from({ length: 11 }, (_, i) => i).map((n) => (
              <button
                key={n}
                type="button"
                className={`${s.npsBtn} ${nps === n ? s.on : ''}`}
                onClick={() => setNps(nps === n ? null : n)}
              >
                {n}
              </button>
            ))}
          </div>
          <div className={s.npsScale}>
            <span>Não recomendaria</span>
            <span>Recomendaria muito</span>
          </div>

          <div className={s.actions}>
            <button type="button" className={s.btnSecondary} onClick={onClose} disabled={busy}>
              Agora não
            </button>
            <button type="button" className={s.btnPrimary} onClick={() => void submit()} disabled={stars < 1 || busy}>
              {busy ? 'Enviando…' : 'Enviar avaliação'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
