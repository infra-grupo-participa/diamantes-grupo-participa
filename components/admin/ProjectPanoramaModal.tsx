'use client';

// B4 — Painel panorama do projeto (admin). Reúne, num só lugar:
//   • briefing básico (acessos do cliente) + briefing do projeto
//   • operadores escalados (união das demandas do projeto)
//   • chat — POR DEMANDA: cada demanda abre o DemandDetailModal (chat read-only)
//
// Sem backend novo: getProjectPanorama faz ~3 queries diretas (admin via RLS).
// Briefings reusam o BriefingReadView (mesmo componente do card do aluno / F1).

import { useEffect, useState } from 'react';
import s from './admin.module.css';
import { initials, fmtDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { errMessage } from '@/lib/errors';
import type { ProjectRow, ProjectDemandStats } from '@/lib/api/admin';
import { getProjectPanorama, type ProjectPanorama } from '@/lib/api/admin-projetos';
import { STATUS_BADGE, type Demand } from '@/lib/api/admin-demandas';
import {
  BRIEFING_SERVICE_LABELS,
  type BriefingAnswers,
} from '@/lib/briefing-templates';
import BriefingReadView, {
  buildGeneralSection,
  buildProjectSections,
  buildAccessSections,
  type BriefingViewSection,
} from '@/components/briefing/BriefingReadView';
import DemandDetailModal from './DemandDetailModal';
import AnimatedBar from '@/components/ui/AnimatedBar';

type Tab = 'geral' | 'briefings' | 'operadores' | 'demandas';

const PROJ_STATUS_LABEL: Record<string, string> = {
  briefing: 'Briefing',
  active: 'Ativo',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

// SLA a partir das demandas em aberto (mesma regra da coluna da tabela).
function slaChip(st?: ProjectDemandStats): { label: string; color: string; bg: string } {
  if (!st || st.demands_open === 0) return { label: 'sem pendências', color: '#6b6584', bg: '#f1eef8' };
  if (st.demands_overdue > 0) {
    const n = st.demands_overdue;
    return { label: `${n} atrasada${n > 1 ? 's' : ''}`, color: '#b42318', bg: '#fee2e2' };
  }
  if (st.next_due) {
    const days = Math.ceil((new Date(st.next_due).getTime() - Date.now()) / 86400000);
    if (days <= 0) return { label: 'vence hoje', color: '#b45309', bg: '#fff4d6' };
    if (days <= 3) return { label: `vence em ${days}d`, color: '#b45309', bg: '#fff4d6' };
    return { label: `no prazo · ${days}d`, color: '#15803d', bg: '#e7f7ee' };
  }
  return { label: 'no prazo', color: '#15803d', bg: '#e7f7ee' };
}

export default function ProjectPanoramaModal({
  project,
  serviceLabels,
  stats,
  briefingProgress,
  onClose,
}: {
  project: ProjectRow;
  serviceLabels: Record<string, string>;
  stats?: ProjectDemandStats;
  briefingProgress?: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<ProjectPanorama | null>(null);
  const [error, setError] = useState('');
  const [openDemand, setOpenDemand] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('geral');

  async function load() {
    setError('');
    try {
      setData(await getProjectPanorama(project.id, project.client_slug));
    } catch (e) {
      setError(errMessage(e));
      toast('Erro ao carregar o projeto: ' + errMessage(e), 'error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.client_slug]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !openDemand) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, openDemand]);

  const services = project.services || [];
  const briefing = project.briefing || {};
  const general = (briefing.general || {}) as BriefingAnswers;
  const svcAns = (briefing.services || {}) as Record<string, BriefingAnswers>;
  const clientName = project.clients?.display_name || project.client_slug;

  // Briefing do projeto: bloco geral + campanha por serviço.
  const projectSections: BriefingViewSection[] = [buildGeneralSection(general)];
  services.forEach((svc) => {
    const lbl = serviceLabels[svc] || BRIEFING_SERVICE_LABELS[svc] || svc;
    projectSections.push(...buildProjectSections(svc, lbl, svcAns[svc] || {}));
  });

  // Briefing básico (acessos) — só os serviços deste projeto.
  const accessSections: BriefingViewSection[] = [];
  const access = data?.access || {};
  services.forEach((svc) => {
    const lbl = serviceLabels[svc] || BRIEFING_SERVICE_LABELS[svc] || svc;
    accessSections.push(...buildAccessSections(svc, lbl, (access[svc] as BriefingAnswers) || {}));
  });

  const demands = data?.demands || [];
  const operators = data?.operators || [];

  function demandSubtitle(d: Demand): string {
    const sb = STATUS_BADGE[d.status] ?? { label: d.status };
    const opened = d.created_at ? fmtDate(d.created_at) : '';
    return [sb.label, opened ? `aberta em ${opened}` : ''].filter(Boolean).join(' · ');
  }

  return (
    <div className={s.briefingOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.briefingCard}>
        <div className={s.briefingHead}>
          <div>
            <div className={s.briefingTitle}>{project.title}</div>
            <div className={s.briefingMeta}>
              {services.map((sv) => serviceLabels[sv] || sv).join(' · ')} · {clientName}
            </div>
          </div>
          <button className={s.modalClose} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={s.briefingBody}>
          {error ? (
            <p className={s.bEmpty}>Erro ao carregar: {error}</p>
          ) : !data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-busy="true">
              <span className={s.skelBlock} style={{ width: '40%', height: 18 }} />
              <span className={s.skelBlock} style={{ width: '85%' }} />
              <span className={s.skelBlock} style={{ width: '70%' }} />
              <span className={s.skelBlock} style={{ width: '55%', height: 18, marginTop: 8 }} />
              <span className={s.skelBlock} style={{ width: '80%' }} />
            </div>
          ) : (
            <>
              {/* Abas */}
              <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16, flexWrap: 'wrap' }}>
                {([
                  ['geral', 'Visão geral'],
                  ['briefings', 'Briefings'],
                  ['operadores', `Operadores (${operators.length})`],
                  ['demandas', `Demandas (${demands.length})`],
                ] as [Tab, string][]).map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTab(k)}
                    style={{
                      padding: '8px 12px',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent',
                      color: tab === k ? 'var(--accent-strong)' : 'var(--muted)',
                      fontWeight: tab === k ? 700 : 600,
                      fontSize: '0.86rem',
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              {/* ── Visão geral: status, SLA, andamento ── */}
              {tab === 'geral' && (() => {
                const total = stats?.demands_total ?? demands.length;
                const done = stats?.demands_done ?? demands.filter((d) => d.status === 'done').length;
                const donePct = total > 0 ? Math.round((done / total) * 100) : 0;
                const sla = slaChip(stats);
                const card: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', background: 'var(--surface)' };
                const cardLabel: React.CSSProperties = { fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 };
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                    <div style={card}>
                      <div style={cardLabel}>Status</div>
                      <span className={`${s.bBadge}`}>{PROJ_STATUS_LABEL[project.status] || project.status}</span>
                    </div>
                    <div style={card}>
                      <div style={cardLabel}>SLA</div>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, padding: '3px 10px', borderRadius: 999, color: sla.color, background: sla.bg }}>{sla.label}</span>
                    </div>
                    <div style={card}>
                      <div style={cardLabel}>Andamento das demandas</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <AnimatedBar pct={donePct} height={6} color={stats && stats.demands_overdue > 0 ? '#ef4444' : 'var(--accent)'} />
                        </div>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>{done}/{total}</span>
                      </div>
                    </div>
                    <div style={card}>
                      <div style={cardLabel}>Briefing</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <AnimatedBar pct={briefingProgress ?? 0} height={6} />
                        </div>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>{briefingProgress ?? 0}%</span>
                      </div>
                    </div>
                    <div style={card}>
                      <div style={cardLabel}>Serviços</div>
                      <div style={{ fontSize: '0.84rem' }}>{services.map((sv) => serviceLabels[sv] || sv).join(', ') || '—'}</div>
                    </div>
                    <div style={card}>
                      <div style={cardLabel}>Criado em</div>
                      <div style={{ fontSize: '0.84rem' }}>{fmtDate(project.created_at)}</div>
                    </div>
                  </div>
                );
              })()}

              {/* Operadores escalados */}
              {tab === 'operadores' && (
              <div className={s.bSection}>
                <div className={s.bSectionHead}>
                  <span>Operadores escalados</span>
                  <span className={s.bSectionTag}>
                    {operators.length} {operators.length === 1 ? 'operador' : 'operadores'}
                  </span>
                </div>
                {operators.length === 0 ? (
                  <p className={s.bEmpty}>Nenhum operador escalado nas demandas deste projeto.</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {operators.map((o) => (
                      <span
                        key={o.operator_id}
                        title={o.position_name || o.email || ''}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 12px 6px 6px',
                          borderRadius: 999,
                          background: 'var(--accent-soft)',
                          border: '1px solid var(--border)',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                        }}
                      >
                        <span
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: '0.7rem',
                            color: '#fff',
                            background: o.position_color
                              ? `linear-gradient(135deg, ${o.position_color}aa, ${o.position_color})`
                              : 'var(--accent)',
                          }}
                        >
                          {initials(o.name)}
                        </span>
                        {o.name || '—'}
                        {o.position_name ? (
                          <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· {o.position_name}</span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* Demandas do projeto — chat por demanda (abre o DemandDetailModal) */}
              {tab === 'demandas' && (
              <div className={s.bSection}>
                <div className={s.bSectionHead}>
                  <span>Demandas &amp; chat</span>
                  <span className={s.bSectionTag}>
                    {demands.length} {demands.length === 1 ? 'demanda' : 'demandas'}
                  </span>
                </div>
                {demands.length === 0 ? (
                  <p className={s.bEmpty}>Este projeto ainda não tem demandas vinculadas.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {demands.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={s.btnView}
                        style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, width: '100%' }}
                        onClick={() => setOpenDemand(d.id)}
                        title="Abrir detalhes e chat desta demanda"
                      >
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                          {d.title || 'Sem título'}
                        </span>
                        <span style={{ flexShrink: 0, color: 'var(--muted)', fontSize: '0.74rem', fontWeight: 500 }}>
                          {demandSubtitle(d)} →
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              )}

              {tab === 'briefings' && (
              <>
              {/* Briefing do projeto */}
              <div className={s.bSection}>
                <div className={s.bSectionHead}>
                  <span>Briefing do projeto</span>
                </div>
                <BriefingReadView sections={projectSections} emptyText="Briefing do projeto ainda não preenchido." />
              </div>

              {/* Briefing básico (acessos do cliente) */}
              <div className={s.bSection}>
                <div className={s.bSectionHead}>
                  <span>Briefing Básico (acessos)</span>
                </div>
                <BriefingReadView
                  sections={accessSections}
                  emptyText="O cliente ainda não preencheu os acessos no Briefing Básico."
                />
              </div>
              </>
              )}
            </>
          )}
        </div>
      </div>

      {openDemand && (
        <DemandDetailModal
          demandId={openDemand}
          onClose={() => setOpenDemand(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
