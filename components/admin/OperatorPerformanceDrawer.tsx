'use client';

import { useEffect, useState } from 'react';
import { getOperatorPerformance, type OperatorPerformance } from '@/lib/api/admin';
import { initials } from '@/lib/format';
import { errMessage } from '@/lib/errors';
import s from './OperatorPerformanceDrawer.module.css';

type Props = {
  operatorId: string;
  operatorName: string | null;
  positionName?: string | null;
  positionColor?: string | null;
  onClose: () => void;
};

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

function StarMeter({ value }: { value: number }) {
  // 5 estrelas com preenchimento proporcional à média (0–5).
  return (
    <span className={s.stars} aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - (i - 1)));
        return (
          <span key={i} className={s.star}>
            <span className={s.starBg}>★</span>
            <span className={s.starFill} style={{ width: `${fill * 100}%` }}>★</span>
          </span>
        );
      })}
    </span>
  );
}

export default function OperatorPerformanceDrawer({ operatorId, operatorName, positionName, positionColor, onClose }: Props) {
  const [data, setData] = useState<OperatorPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getOperatorPerformance(operatorId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(errMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [operatorId]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const demandAvg = num(data?.demand_avg);
  const projectAvg = num(data?.project_avg);
  const dist = data?.demand_star_distribution ?? {};
  const maxDist = Math.max(1, ...[5, 4, 3, 2, 1].map((k) => num(dist[String(k)])));

  return (
    <>
      <div className={s.backdrop} onClick={onClose} />
      <aside className={s.drawer} role="dialog" aria-label="Performance do operador">
        <header className={s.head}>
          <span
            className={s.avatar}
            style={positionColor ? { background: `linear-gradient(135deg, ${positionColor}cc, ${positionColor})` } : undefined}
          >
            {initials(operatorName)}
          </span>
          <div className={s.headInfo}>
            <strong>{operatorName || '—'}</strong>
            <span>{positionName || 'Operador'} · atua via ClickUp</span>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Fechar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {loading ? (
          <div className={s.state}>Carregando performance…</div>
        ) : error ? (
          <div className={s.state}>Erro: {error}</div>
        ) : !data ? (
          <div className={s.state}>Operador sem dados de performance.</div>
        ) : (
          <div className={s.body}>
            {/* Duas dimensões: demandas e projetos */}
            <div className={s.dims}>
              <div className={s.dim}>
                <span className={s.dimLabel}>Avaliação por demanda</span>
                <div className={s.dimMain}>
                  <strong>{demandAvg ? demandAvg.toFixed(2) : '—'}</strong>
                  <StarMeter value={demandAvg} />
                </div>
                <span className={s.dimSub}>
                  {data.demand_rating_count} {data.demand_rating_count === 1 ? 'avaliação' : 'avaliações'} · {data.demands_count} demandas
                </span>
              </div>
              <div className={s.dim}>
                <span className={s.dimLabel}>Satisfação por projeto</span>
                <div className={s.dimMain}>
                  <strong>{projectAvg ? projectAvg.toFixed(2) : '—'}</strong>
                  <StarMeter value={projectAvg} />
                </div>
                <span className={s.dimSub}>
                  {data.project_rating_count} {data.project_rating_count === 1 ? 'projeto' : 'projetos'}
                  {num(data.project_nps_avg) > 0 ? ` · NPS ${num(data.project_nps_avg).toFixed(0)}` : ''}
                </span>
              </div>
            </div>

            {/* Pontos acumulados */}
            <div className={s.points}>
              <span className={s.pointsIco}>🏆</span>
              <div>
                <strong>{num(data.points_score).toLocaleString('pt-BR')}</strong>
                <span>pontos acumulados ao longo dos serviços</span>
              </div>
            </div>

            {/* Distribuição de estrelas */}
            <div className={s.distBlock}>
              <span className={s.distTitle}>Distribuição das notas (demandas)</span>
              {data.demand_rating_count === 0 ? (
                <p className={s.distEmpty}>Ainda sem avaliações de clientes.</p>
              ) : (
                <ul className={s.dist}>
                  {[5, 4, 3, 2, 1].map((star) => {
                    const c = num(dist[String(star)]);
                    return (
                      <li key={star}>
                        <span className={s.distStar}>{star}★</span>
                        <span className={s.distTrack}>
                          <span className={s.distFill} style={{ width: `${(c / maxDist) * 100}%` }} />
                        </span>
                        <span className={s.distCount}>{c}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
