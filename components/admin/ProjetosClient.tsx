'use client';

import { useCallback, useEffect, useState } from 'react';
import s from './admin.module.css';
import { listProjects, type ProjectRow } from '@/lib/api/admin';
import {
  getGeneralFields,
  getProjectSections,
  validateProjectBriefing,
} from '@/lib/briefing-templates';
import { fmtDate } from '@/lib/format';
import BriefingModal from './BriefingModal';

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
  const [selected, setSelected] = useState<ProjectRow | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setError('');
    try {
      setRows(await listProjects({ service, status, briefing }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [service, status, briefing]);

  useEffect(() => {
    load();
  }, [load]);

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
                <td colSpan={7} className={s.emptyState}>
                  Erro ao carregar: {error}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className={s.emptyState}>
                  Nenhum projeto encontrado.
                </td>
              </tr>
            ) : (
              rows.map((p) => {
                const progress = calcProgress(p);
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
                      <span className={`${s.bBadge} ${statusClass(p.status)}`}>{statusLabel(p.status)}</span>
                    </td>
                    <td>{fmtDate(p.created_at)}</td>
                    <td>
                      <button className={s.btnView} onClick={() => setSelected(p)}>
                        Ver briefing
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selected && <BriefingModal project={selected} serviceLabels={SERVICE_LABELS} onClose={() => setSelected(null)} />}
    </div>
  );
}
