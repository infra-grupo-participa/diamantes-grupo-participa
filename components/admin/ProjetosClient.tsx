'use client';

import { useCallback, useEffect, useState } from 'react';
import s from './admin.module.css';
import {
  listProjects,
  completeProject,
  listProjectDemandStats,
  type ProjectRow,
  type ProjectDemandStats,
} from '@/lib/api/admin';
import { toast } from '@/lib/toast';
import {
  getGeneralFields,
  getProjectSections,
  validateProjectBriefing,
} from '@/lib/briefing-templates';
import { fmtDate } from '@/lib/format';
import ProjectPanoramaModal from './ProjectPanoramaModal';

// Rótulos espelhados do legado admin/projetos.html (com emoji)
const SERVICE_LABELS: Record<string, string> = {
  anuncios_pagos: '📣 Tráfego',
  edicao_video: '🎬 Edição',
  paginas: '💻 Páginas',
  automacao: '⚙️ Automação',
  // legados (exibição de dados antigos)
  design_grafico: '🎨 Design Gráfico',
  social_media: '📱 Social Media',
  web_design_automacao: '💻 Web/Auto.',
};

// Progresso do evento: bloco geral (red) + seções project (red) dos serviços do evento.
function calcProgress(p: ProjectRow): number {
  const services = p.services || [];
  const briefing = p.briefing || {};
  let total = getGeneralFields().filter((f) => f.priority === 'red').length;
  services.forEach((svc) =>
    getProjectSections(svc).forEach((sec) => sec.fields.forEach((f) => { if (f.priority === 'red') total++; })),
  );
  if (!total) return 100;
  const { missing } = validateProjectBriefing(services, briefing);
  return Math.round((Math.max(0, total - missing.length) / total) * 100);
}

function statusLabel(st: string): string {
  return ({ briefing: 'Briefing', active: 'Ativo', completed: 'Concluído', cancelled: 'Cancelado' } as Record<string, string>)[st] || st;
}

// SLA do projeto a partir das demandas em aberto: atrasadas (vermelho), vence em
// breve (âmbar) ou no prazo (verde). Sem demandas abertas → neutro.
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

function statusClass(status: string): string {
  return (
    {
      briefing: s.bBriefing,
      active: s.bActive,
      completed: s.bCompleted,
      cancelled: s.bCancelled,
    } as Record<string, string>
  )[status] || s.bBriefing;
}

function ProjSkeletonRows() {
  const widths = ['65%', '50%', '55%', '40%', '45%', '48%', '30%'];
  return (
    <>
      {Array.from({ length: 6 }).map((_, r) => (
        <tr key={r} className={s.skelRow}>
          {widths.map((w, c) => (
            <td key={c}>
              <span className={s.skelBlock} style={{ width: w }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function ProjetosClient() {
  const [service, setService] = useState('');
  const [status, setStatus] = useState('');
  const [briefing, setBriefing] = useState('');
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState('');
  const [panorama, setPanorama] = useState<ProjectRow | null>(null);
  const [stats, setStats] = useState<Record<string, ProjectDemandStats>>({});

  const load = useCallback(async () => {
    setRows(null);
    setError('');
    try {
      const [projs, st] = await Promise.all([
        listProjects({ service, status, briefing }),
        listProjectDemandStats().catch(() => ({}) as Record<string, ProjectDemandStats>),
      ]);
      setStats(st);
      setRows(projs);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [service, status, briefing]);

  useEffect(() => {
    load();
  }, [load]);

  async function onComplete(p: ProjectRow) {
    if (!confirm(`Concluir o projeto "${p.title}"?\n\nO cliente receberá o convite para avaliar.`)) return;
    try {
      await completeProject(p.id);
      toast('Projeto concluído. Avaliação solicitada ao cliente.');
      await load();
    } catch (e: unknown) {
      toast('Erro ao concluir: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  }

  return (
    <div className={s.shell}>
      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Projetos / Briefings</h1>
          <p className={s.pageSub}>Briefings de abertura enviados pelos clientes.</p>
        </div>
      </div>

      <div className={s.filters}>
        <select className={s.selectInput} value={service} onChange={(e) => setService(e.target.value)}>
          <option value="">Todos os serviços</option>
          <option value="anuncios_pagos">Tráfego</option>
          <option value="edicao_video">Edição</option>
          <option value="paginas">Páginas</option>
          <option value="automacao">Automação</option>
        </select>
        <select className={s.selectInput} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="briefing">Briefing pendente</option>
          <option value="active">Ativo</option>
          <option value="completed">Concluído</option>
          <option value="cancelled">Cancelado</option>
        </select>
        <select className={s.selectInput} value={briefing} onChange={(e) => setBriefing(e.target.value)}>
          <option value="">Qualquer briefing</option>
          <option value="draft">Rascunho</option>
          <option value="submitted">Enviado</option>
        </select>
      </div>

      <div className={s.projTableWrap}>
        <table className={s.projTable}>
          <thead>
            <tr>
              <th>Projeto</th>
              <th>Cliente</th>
              <th>Serviço</th>
              <th>Briefing</th>
              <th>Demandas</th>
              <th>Status</th>
              <th>Criado em</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <ProjSkeletonRows />
            ) : error ? (
              <tr>
                <td colSpan={8} className={s.emptyState}>
                  Erro ao carregar: {error}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className={s.emptyState}>
                  Nenhum projeto encontrado.
                </td>
              </tr>
            ) : (
              rows.map((p) => {
                const progress = calcProgress(p);
                const st = stats[p.id];
                const donePct = st && st.demands_total > 0 ? Math.round((st.demands_done / st.demands_total) * 100) : 0;
                const sla = slaChip(st);
                const clientName = p.clients?.display_name || p.client_slug;
                const svcList = (p.services || []).map((sv) => SERVICE_LABELS[sv] || sv).join(', ') || '—';
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.title}</strong>
                    </td>
                    <td>{clientName}</td>
                    <td>
                      <span className={s.serviceLabel}>{svcList}</span>
                    </td>
                    <td>
                      <span className={`${s.bBadge} ${p.briefing_status === 'submitted' ? s.bSubmitted : s.bDraft}`}>
                        {p.briefing_status === 'submitted' ? 'Enviado' : 'Rascunho'}
                      </span>
                      <div className={s.progressPill}>
                        <div className={s.bar}>
                          <div className={s.fill} style={{ width: `${progress}%` }} />
                        </div>
                        {progress}%
                      </div>
                    </td>
                    <td>
                      {st && st.demands_total > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 104 }}>
                          <div className={s.progressPill}>
                            <div className={s.bar}>
                              <div
                                className={s.fill}
                                style={{ width: `${donePct}%`, background: st.demands_overdue > 0 ? '#ef4444' : undefined }}
                              />
                            </div>
                            {st.demands_done}/{st.demands_total}
                          </div>
                          <span
                            style={{
                              alignSelf: 'flex-start',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: 999,
                              color: sla.color,
                              background: sla.bg,
                            }}
                          >
                            {sla.label}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>sem demandas</span>
                      )}
                    </td>
                    <td>
                      <span className={`${s.bBadge} ${statusClass(p.status)}`}>{statusLabel(p.status)}</span>
                    </td>
                    <td>{fmtDate(p.created_at)}</td>
                    <td>
                      <div className={s.projActions}>
                        <button
                          className={s.btnView}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          onClick={() => setPanorama(p)}
                          title="Painel do projeto: visão geral, SLA, briefings, operadores e chat"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="20" x2="18" y2="10" />
                            <line x1="12" y1="20" x2="12" y2="4" />
                            <line x1="6" y1="20" x2="6" y2="14" />
                          </svg>
                          Painel
                        </button>
                        {p.status === 'active' && (
                          <button
                            className={s.btnView}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                            onClick={() => onComplete(p)}
                            title="Concluir projeto e solicitar avaliação"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                              <polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                            Concluir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {panorama && (
        <ProjectPanoramaModal
          project={panorama}
          serviceLabels={SERVICE_LABELS}
          stats={stats[panorama.id]}
          briefingProgress={calcProgress(panorama)}
          onClose={() => setPanorama(null)}
        />
      )}
    </div>
  );
}
