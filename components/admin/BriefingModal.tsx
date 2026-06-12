'use client';

import { useEffect, useState } from 'react';
import s from './admin.module.css';
import type { ProjectRow } from '@/lib/api/admin';
import { getClientBriefingAccess } from '@/lib/api/admin';
import { getGeneralFields, getProjectSections, getBaseSections } from '@/lib/briefing-templates';

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function displayValue(v: unknown): string {
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  return String(v);
}

function FieldRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className={s.bRow}>
      <span className={s.bRowLabel}>{label}</span>
      <span className={s.bRowValue}>{displayValue(value)}</span>
    </div>
  );
}

function Section({ title, rows, tag }: { title: string; rows: React.ReactNode[]; tag?: string }) {
  if (!rows.length) return null;
  return (
    <div className={s.bSection}>
      <div className={s.bSectionHead}>
        <span>{title}</span>
        {tag && <span className={s.bSectionTag}>{tag}</span>}
      </div>
      {rows}
    </div>
  );
}

export default function BriefingModal({
  project,
  serviceLabels,
  onClose,
}: {
  project: ProjectRow;
  serviceLabels: Record<string, string>;
  onClose: () => void;
}) {
  const [access, setAccess] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getClientBriefingAccess(project.client_slug).then((a) => {
      if (alive) {
        setAccess(a);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [project.client_slug]);

  const services = project.services || [];
  const briefing = project.briefing || {};
  const general = briefing.general || {};
  const svcAns = briefing.services || {};
  const clientName = project.clients?.display_name || project.client_slug;

  const sections: React.ReactNode[] = [];
  let rowCount = 0;

  // Bloco geral do evento
  const gRows = getGeneralFields()
    .map((f) => {
      const v = (general as Record<string, unknown>)[f.id];
      return isEmpty(v) ? null : <FieldRow key={`g-${f.id}`} label={f.label} value={v} />;
    })
    .filter(Boolean) as React.ReactNode[];
  rowCount += gRows.length;
  sections.push(<Section key="geral" title="Dados do evento" rows={gRows} />);

  // Por serviço: campanha (project) + acessos (base, herdados)
  services.forEach((svc) => {
    const lbl = serviceLabels[svc] || svc;
    const ans = (svcAns[svc] as Record<string, unknown>) || {};

    const projRows: React.ReactNode[] = [];
    getProjectSections(svc).forEach((sec) =>
      sec.fields.forEach((f) => {
        const v = ans[f.id];
        if (!isEmpty(v)) projRows.push(<FieldRow key={`p-${svc}-${f.id}`} label={f.label} value={v} />);
      }),
    );
    rowCount += projRows.length;
    sections.push(<Section key={`camp-${svc}`} title={`${lbl} — campanha`} rows={projRows} />);

    const acc = (access[svc] as Record<string, unknown>) || {};
    const accRows: React.ReactNode[] = [];
    getBaseSections(svc).forEach((sec) =>
      sec.fields.forEach((f) => {
        const v = acc[f.id];
        if (!isEmpty(v)) accRows.push(<FieldRow key={`a-${svc}-${f.id}`} label={f.label} value={v} />);
      }),
    );
    rowCount += accRows.length;
    sections.push(<Section key={`acc-${svc}`} title={`${lbl} — acessos`} rows={accRows} tag="do Briefing Básico" />);
  });

  const hasContent = rowCount > 0;

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
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-busy="true">
              <span className={s.skelBlock} style={{ width: '40%', height: 18 }} />
              <span className={s.skelBlock} style={{ width: '85%' }} />
              <span className={s.skelBlock} style={{ width: '70%' }} />
              <span className={s.skelBlock} style={{ width: '90%' }} />
              <span className={s.skelBlock} style={{ width: '55%', height: 18, marginTop: 8 }} />
              <span className={s.skelBlock} style={{ width: '80%' }} />
              <span className={s.skelBlock} style={{ width: '65%' }} />
            </div>
          ) : hasContent ? (
            sections
          ) : (
            <p className={s.bEmpty}>Briefing ainda não preenchido.</p>
          )}
        </div>
      </div>
    </div>
  );
}
