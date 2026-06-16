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
import type { ProjectRow } from '@/lib/api/admin';
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

export default function ProjectPanoramaModal({
  project,
  serviceLabels,
  onClose,
}: {
  project: ProjectRow;
  serviceLabels: Record<string, string>;
  onClose: () => void;
}) {
  const [data, setData] = useState<ProjectPanorama | null>(null);
  const [error, setError] = useState('');
  const [openDemand, setOpenDemand] = useState<string | null>(null);

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
              {/* Operadores escalados */}
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

              {/* Demandas do projeto — chat por demanda (abre o DemandDetailModal) */}
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
