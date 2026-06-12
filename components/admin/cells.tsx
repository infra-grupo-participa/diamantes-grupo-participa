'use client';

import s from './admin.module.css';

const STAR_PATH = '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2';

/** Estrelas a partir de rating já em escala 0-5 (rating_avg das views). */
export function Stars({ rating }: { rating?: number | null }) {
  const r = Number(rating) || 0;
  if (r <= 0) {
    return (
      <span className={s.ratingEmpty} title="Ainda sem avaliações vinculadas">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ opacity: 0.5 }}>
          <polygon points={STAR_PATH} />
        </svg>
        <span className={s.dash}>—</span>
        <span className={s.sub}>sem avaliações</span>
      </span>
    );
  }
  const full = Math.round(r);
  return (
    <span className={s.stars}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width="13" height="13" viewBox="0 0 24 24" fill={i <= full ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4">
          <polygon points={STAR_PATH} />
        </svg>
      ))}
      <span className={s.ratingValue}>{r.toFixed(2).replace('.', ',')}</span>
    </span>
  );
}

const STATUS_MAP: Record<string, { cls: string; txt: string }> = {
  approved: { cls: s.stApproved, txt: 'Ativo' },
  disabled: { cls: s.stDisabled, txt: 'Desabilitado' },
  rejected: { cls: s.stRejected, txt: 'Rejeitado' },
  pending: { cls: s.stPending, txt: 'Pendente' },
};

export function StatusCell({ status }: { status: string }) {
  const b = STATUS_MAP[status] || { cls: s.stPending, txt: status || '—' };
  return (
    <span className={`${s.statusBadge} ${b.cls}`}>
      <span className={s.dot} />
      {b.txt}
    </span>
  );
}

const OP_STATUS_MAP: Record<string, { cls: string; txt: string }> = {
  active: { cls: s.stApproved, txt: 'Ativo' },
  inactive: { cls: s.stDisabled, txt: 'Inativo' },
  suspended: { cls: s.stRejected, txt: 'Suspenso' },
};

export function OpStatusCell({ status }: { status: string }) {
  const b = OP_STATUS_MAP[status] || { cls: s.stPending, txt: status || '—' };
  return (
    <span className={`${s.statusBadge} ${b.cls}`}>
      <span className={s.dot} />
      {b.txt}
    </span>
  );
}

export function PositionPill({ name, color }: { name?: string | null; color?: string | null }) {
  if (!name) return <span className={s.subtle}>—</span>;
  return (
    <span className={`${s.rolePill} ${s.rolePillOperator}`} style={{ background: color || '#94a3b8' }}>
      <span className={s.dot} />
      {name}
    </span>
  );
}
