'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getMe,
  getDashboard,
  listMyStudents,
  listAssignedDemands,
  type OperatorProfile,
  type OperatorDashboard as Dashboard,
  type AssignedDemand,
  type MyStudent,
  type WorkloadSlice,
} from '@/lib/api/operator';
import { initials, firstName } from '@/lib/format';
import {
  DemandIcon,
  inferIconClass,
  STATUS_LABEL,
  STATUS_TAG,
  STATUS_COLOR,
  dueMeta,
} from '@/components/operator/demand-meta';
import s from './dashboard.module.css';

const GRADIENTS: [string, string][] = [
  ['#fde68a', '#f59e0b'],
  ['#bae6fd', '#0284c7'],
  ['#f5d0fe', '#a855f7'],
  ['#fecaca', '#ef4444'],
  ['#bbf7d0', '#16a34a'],
  ['#c7d2fe', '#6366f1'],
  ['#fed7aa', '#ea580c'],
  ['#fbcfe8', '#db2777'],
];
function avatarStyle(name?: string | null): string {
  const str = String(name || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const [a, b] = GRADIENTS[h % GRADIENTS.length];
  return `linear-gradient(135deg,${a},${b})`;
}

function fmtRelative(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return Math.floor(diff / 60) + ' min';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function fmtRating(score?: number | null): string {
  if (score == null) return '—';
  const n = Number(score);
  if (!isFinite(n)) return '—';
  return n.toFixed(2).replace('.', ',');
}

const TAG_CLASS: Record<string, string> = {
  new: s.tagNew,
  in_progress: s.tagIn_progress,
  review: s.tagReview,
  done: s.tagDone,
};

function StatusTag({ status }: { status: string }) {
  const tag = STATUS_TAG[status] || 'new';
  return <span className={`${s.demandTag} ${TAG_CLASS[tag] || s.tagNew}`}>{STATUS_LABEL[status] || status}</span>;
}

function Donut({ workload, activeTotal }: { workload: WorkloadSlice[]; activeTotal: number | string }) {
  const total = workload.reduce((acc, w) => acc + (w.count || 0), 0);
  let offset = 0;
  const segs = workload.map((w) => {
    const pct = total ? Math.round((w.count / total) * 100) : 0;
    const seg = {
      color: STATUS_COLOR[w.status] || '#94a3b8',
      pct,
      offset,
      label: STATUS_LABEL[w.status] || w.status,
    };
    offset += pct;
    return seg;
  });
  return (
    <>
      <div className={s.chartWrap}>
        <div className={s.donut}>
          <svg width="130" height="130" viewBox="0 0 42 42">
            <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#eef0f7" strokeWidth="6" />
            {total > 0 &&
              segs.map((seg, i) => (
                <circle
                  key={i}
                  cx="21"
                  cy="21"
                  r="15.915"
                  fill="transparent"
                  stroke={seg.color}
                  strokeWidth="6"
                  strokeDasharray={`${seg.pct} ${100 - seg.pct}`}
                  strokeDashoffset={String(-seg.offset)}
                  strokeLinecap="round"
                />
              ))}
          </svg>
          <div className={s.donutCenter}>
            <div>
              <div className={s.donutBig}>{total}</div>
              <div className={s.donutLbl}>{total === 1 ? 'Demanda' : 'Demandas'}</div>
            </div>
          </div>
        </div>
        <div className={s.legend}>
          {total === 0 ? (
            <div className={s.legendRow} style={{ color: 'var(--muted)' }}>
              Sem demandas pra mostrar.
            </div>
          ) : (
            segs.map((seg, i) => (
              <div className={s.legendRow} key={i}>
                <span className={s.legendDot} style={{ background: seg.color }} />
                {seg.label}
                <span className={s.legendPct}>{seg.pct}%</span>
              </div>
            ))
          )}
        </div>
      </div>
      <div className={s.chartStats}>
        <div>
          <div className={s.num}>{activeTotal ?? '—'}</div>
          <div className={s.ttl}>Ativas agora</div>
        </div>
      </div>
    </>
  );
}

export default function OperatorDashboard() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<OperatorProfile | null>(null);
  const [dash, setDash] = useState<Dashboard>({});
  const [students, setStudents] = useState<MyStudent[]>([]);
  const [demands, setDemands] = useState<AssignedDemand[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meRow = await getMe().catch(() => null);
      const [d, st, ad] = await Promise.all([
        getDashboard().catch((e) => {
          console.error(e);
          return {} as Dashboard;
        }),
        listMyStudents().catch((e) => {
          console.error(e);
          return [] as MyStudent[];
        }),
        listAssignedDemands({ status: 'all' }).catch((e) => {
          console.error(e);
          return [] as AssignedDemand[];
        }),
      ]);
      if (cancelled) return;
      setMe(meRow);
      setDash(d);
      setStudents(st);
      setDemands(ad);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className={s.wrap}>
        <div className={s.greet}>
          <div className={`${s.sk} ${s.skLine}`} style={{ width: 220, height: 26 }} />
          <div className={`${s.sk} ${s.skLine}`} style={{ width: 300, marginTop: 8 }} />
        </div>
        <div className={s.kpiGrid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${s.sk} ${s.skKpi}`} />
          ))}
        </div>
        <div className={s.grid3}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`${s.sk} ${s.skCard}`} />
          ))}
        </div>
        <div className={s.grid2}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className={`${s.sk} ${s.skCard}`} />
          ))}
        </div>
      </div>
    );
  }

  const kpi = dash.kpi || {};
  const active = demands.filter((d) => d.status !== 'done' && d.status !== 'canceled');
  const activeTop = active.slice(0, 5);
  const urgent = dash.urgent || [];
  const recent = dash.recent || [];
  const ratingsReceived = dash.recent_ratings_received || [];

  return (
    <div className={s.wrap}>
      <div className={s.greet}>
        <h1>
          Olá, {firstName(me?.name) || 'Operador'} <span className={s.wave}>👋</span>
        </h1>
        <p className={s.greetSub}>Aqui está o resumo das suas atividades de hoje.</p>
      </div>

      {/* KPIs */}
      <div className={s.kpiGrid}>
        <div className={s.kpi}>
          <div className={`${s.kpiIco} ${s.indigo}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div>
            <div className={s.kpiLabel}>Chamadas em aberto</div>
            <div className={s.kpiValue}>{kpi.open_count ?? 0}</div>
          </div>
        </div>
        <div className={s.kpi}>
          <div className={`${s.kpiIco} ${s.orange}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div>
            <div className={s.kpiLabel}>Em execução</div>
            <div className={s.kpiValue}>{kpi.in_progress_count ?? 0}</div>
          </div>
        </div>
        <div className={s.kpi}>
          <div className={`${s.kpiIco} ${s.green}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <div className={s.kpiLabel}>Concluídas hoje</div>
            <div className={s.kpiValue}>{kpi.done_today_count ?? 0}</div>
          </div>
        </div>
        <div className={s.kpi}>
          <div className={`${s.kpiIco} ${s.yellow}`}>
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="0.4">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div>
            <div className={s.kpiLabel}>Avaliação média</div>
            <div className={s.kpiValue}>{fmtRating(kpi.rating_avg)}</div>
            <div className={s.kpiTrend}>
              {kpi.rating_count ? `Baseado em ${kpi.rating_count} avaliações` : 'Sem avaliações ainda'}
            </div>
          </div>
        </div>
      </div>

      {/* Linha 2 */}
      <div className={s.grid3}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h2>Minhas demandas ativas</h2>
              <div className={s.meta}>
                {activeTop.length === 0
                  ? '0 demandas ativas'
                  : `${active.length} demandas em andamento`}
              </div>
            </div>
            <Link href="/operator/demandas" className={s.seeAll}>
              Ver todas →
            </Link>
          </div>
          <div className={s.demandList}>
            {activeTop.length === 0 ? (
              <div className={s.empty}>Você não tem demandas ativas no momento.</div>
            ) : (
              activeTop.map((d) => {
                const cls = inferIconClass(d.title);
                return (
                  <Link key={d.id} href={`/operator/demandas?d=${d.id}`} className={s.demandRow}>
                    <div className={`${s.demandIcon} ${s[cls]}`}>
                      <DemandIcon cls={cls} />
                    </div>
                    <div className={s.demandInfo}>
                      <div className={s.demandTitle}>
                        {d.title}
                        <StatusTag status={d.status} />
                      </div>
                      <div className={s.demandMeta}>
                        {d.client_display_name || '—'}
                        <span className={s.sep}>•</span> {dueMeta(d)}
                      </div>
                    </div>
                    <span className={s.demandMeta}>{fmtRelative(d.last_message_at || d.updated_at)}</span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h2>Minha carga de trabalho</h2>
              <div className={s.meta}>Hoje</div>
            </div>
          </div>
          <Donut workload={dash.workload || []} activeTotal={kpi.active_total ?? active.length} />
        </div>

        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h2>Chamados urgentes</h2>
              <div className={s.meta}>
                {urgent.length === 0
                  ? 'Nada com prazo apertado'
                  : `${urgent.length} ${urgent.length === 1 ? 'precisa' : 'precisam'} de você`}
              </div>
            </div>
          </div>
          <div className={s.urgentList}>
            {urgent.length === 0 ? (
              <div className={s.empty}>Tudo sob controle 🎉</div>
            ) : (
              urgent.map((u) => {
                const sub =
                  u.days_left == null
                    ? '—'
                    : u.days_left < 0
                      ? `Atrasada ${Math.abs(u.days_left)} dia(s)`
                      : u.days_left === 0
                        ? 'Prazo hoje'
                        : u.days_left === 1
                          ? 'Prazo amanhã'
                          : `Em ${u.days_left} dias`;
                return (
                  <Link key={u.id} href={`/operator/demandas?d=${u.id}`} className={s.urgentRow}>
                    <span className={s.pulse} />
                    <div className={s.urgentInfo}>
                      <div className={s.urgentTitle}>{u.title}</div>
                      <div className={s.urgentSub}>
                        {u.client_display_name || '—'} • {sub}
                      </div>
                    </div>
                    <span className={s.arrow}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Pontos + avaliações recebidas */}
      <div className={s.grid2}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h2>Pontos e ranking</h2>
              <div className={s.meta}>
                {(kpi.points_this_month ?? 0) > 0
                  ? `${kpi.points_this_month} pts conquistados este mês`
                  : 'Comece a entregar pra ganhar pontos'}
              </div>
            </div>
          </div>
          <div className={s.pointsWrap}>
            <div className={s.pointsHero}>
              <div className={s.pointsTotal}>{kpi.points_total ?? 0}</div>
              <div className={s.pointsLbl}>PONTOS</div>
            </div>
            <div className={s.pointsSide}>
              <div className={s.pointsRow}>
                <span className={s.k}>Este mês</span>
                <span className={s.v}>+{kpi.points_this_month ?? 0} pts</span>
              </div>
              <div className={s.pointsRow}>
                <span className={s.k}>Ranking</span>
                <span className={s.v}>
                  {kpi.ranking_position && kpi.ranking_total
                    ? `${kpi.ranking_position}º de ${kpi.ranking_total}`
                    : '—'}
                </span>
              </div>
              <div className={s.pointsRow}>
                <span className={s.k}>Avaliações</span>
                <span className={s.v}>
                  {kpi.rating_count && kpi.rating_count > 0
                    ? `${fmtRating(kpi.rating_avg)} · ${kpi.rating_count} avaliação${kpi.rating_count === 1 ? '' : 'ões'}`
                    : 'Sem avaliações'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h2>Avaliações recebidas</h2>
            </div>
          </div>
          <div className={s.ratingsReceived}>
            {ratingsReceived.length === 0 ? (
              <div className={s.empty}>
                Quando seus alunos avaliarem as demandas, as notas aparecem aqui.
              </div>
            ) : (
              ratingsReceived.map((r, i) => (
                <div className={s.ratingRow} key={i}>
                  <span className={s.scorePill}>{r.score}/10</span>
                  <div>
                    <div className={s.rrTitle}>{r.demand_title || '—'}</div>
                    <div className={s.rrSub}>{r.client_display_name || '—'}</div>
                    {r.comment && <div className={s.rrComment}>&quot;{r.comment}&quot;</div>}
                  </div>
                  <div className={s.rrWhen}>{fmtRelative(r.submitted_at)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Alunos + atividades */}
      <div className={s.grid2}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h2>Meus alunos no plano</h2>
              <div className={s.meta}>
                {students.length === 0
                  ? 'Nenhum aluno alocado'
                  : `${students.length} ${students.length === 1 ? 'aluno atendido' : 'alunos atendidos'} por você`}
              </div>
            </div>
          </div>
          <div className={s.studentsGrid}>
            {students.length === 0 ? (
              <div className={s.empty} style={{ gridColumn: '1/-1' }}>
                Sem alocações em team_assignments. Peça ao admin para te vincular a um aluno.
              </div>
            ) : (
              students.map((st) => (
                <div className={s.studentCard} key={st.slug}>
                  <div className={s.studentAvatar} style={{ background: avatarStyle(st.display_name) }}>
                    {initials(st.display_name)}
                  </div>
                  <div>
                    <div className={s.studentName}>{st.display_name}</div>
                    <div className={s.studentPlan}>{st.plan_name || 'Diamante'}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h2>Atividade recente</h2>
            </div>
          </div>
          <div className={s.activity}>
            {recent.length === 0 ? (
              <div className={s.empty}>Nenhuma mensagem recente.</div>
            ) : (
              recent.map((r, i) => (
                <div className={s.activityRow} key={i}>
                  <span className={s.activityDot} />
                  <div>
                    <div className={s.activityText}>
                      <strong>{r.author_name}</strong> em <em>{r.demand_title}</em>:{' '}
                      {r.preview || '(anexo)'}
                    </div>
                    <div className={s.activityWhen}>{fmtRelative(r.created_at)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
