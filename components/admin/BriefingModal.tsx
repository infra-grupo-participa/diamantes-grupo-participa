'use client';

import { useEffect, useState } from 'react';
import s from './admin.module.css';
import type { ProjectRow } from '@/lib/api/admin';
import { getClientBriefingAccess } from '@/lib/api/admin';
import type { BriefingAnswers } from '@/lib/briefing-templates';
import BriefingReadView, {
  buildGeneralSection,
  buildProjectSections,
  buildAccessSections,
  type BriefingViewSection,
} from '@/components/briefing/BriefingReadView';

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

  const sections: BriefingViewSection[] = [buildGeneralSection(general as BriefingAnswers)];
  services.forEach((svc) => {
    const lbl = serviceLabels[svc] || svc;
    sections.push(...buildProjectSections(svc, lbl, (svcAns[svc] as BriefingAnswers) || {}));
    sections.push(...buildAccessSections(svc, lbl, (access[svc] as BriefingAnswers) || {}));
  });

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
          ) : (
            <BriefingReadView sections={sections} />
          )}
        </div>
      </div>
    </div>
  );
}
