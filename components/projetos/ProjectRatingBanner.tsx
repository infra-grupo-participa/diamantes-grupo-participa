'use client';

// Banner insistente: enquanto houver projeto concluído sem avaliação, convida
// o cliente a avaliar. Não bloqueia nada (decisão de produto). RPC via
// get_my_pending_project_ratings / submit_project_rating (migration 036).

import { useCallback, useEffect, useState } from 'react';
import { getMyPendingProjectRatings, type PendingProjectRating } from '@/lib/api/projects';
import ProjectRatingModal from './ProjectRatingModal';
import s from './projetoRating.module.css';

export default function ProjectRatingBanner() {
  const [pending, setPending] = useState<PendingProjectRating[]>([]);
  const [open, setOpen] = useState<PendingProjectRating | null>(null);

  const load = useCallback(async () => {
    try {
      setPending(await getMyPendingProjectRatings());
    } catch {
      setPending([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (pending.length === 0) return null;

  const next = pending[0];
  const rest = pending.length - 1;

  return (
    <>
      <div className={s.banner}>
        <div className={s.bannerIcon} aria-hidden>⭐</div>
        <div className={s.bannerBody}>
          <div className={s.bannerTitle}>Seu projeto foi concluído — conte como foi!</div>
          <div className={s.bannerSub}>
            <strong>{next.title}</strong>
            {rest > 0 && ` e mais ${rest} projeto${rest > 1 ? 's' : ''} aguardando avaliação`}
          </div>
        </div>
        <button type="button" className={s.bannerBtn} onClick={() => setOpen(next)}>
          Avaliar agora
        </button>
      </div>

      {open && (
        <ProjectRatingModal
          projectId={open.project_id}
          projectTitle={open.title}
          onClose={() => setOpen(null)}
          onSubmitted={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </>
  );
}
