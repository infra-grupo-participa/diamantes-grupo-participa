'use client';

// BriefingReadView — componente COMPARTILHADO de leitura de briefing.
// Extraído do BriefingModal do admin (FieldRow/Section), com paridade visual.
//
// CRÍTICO: usa formatFieldValue de lib/briefing-pdf.ts para formatar valores
// (boolean→Sim/Não, date, arrays, cartão e objetos) — evita o "[object Object]"
// (bug do commit 4baba6f). NÃO mapeia "serviço → chave de briefing": as seções
// são montadas a partir da estrutura do template (lib/briefing-templates.ts) e
// os valores vêm direto das chaves do JSON de respostas.

import type { ReactNode } from 'react';
import { formatFieldValue } from '@/lib/briefing-pdf';
import {
  getGeneralFields,
  getBaseSections,
  getProjectSections,
  type BriefingAnswers,
} from '@/lib/briefing-templates';
import css from './BriefingReadView.module.css';

/** Uma seção pronta para exibição: título + linhas (label/value já resolvidos). */
export interface BriefingViewSection {
  key: string;
  title: string;
  tag?: string;
  rows: Array<{ key: string; label: string; value: string }>;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

// ── Builders de seção (puros) ───────────────────────────────────────────────

/** Bloco geral do evento (briefing.general). */
export function buildGeneralSection(general: BriefingAnswers | null | undefined): BriefingViewSection {
  const ans = general || {};
  const rows = getGeneralFields()
    .map((f) => {
      const v = ans[f.id];
      if (isEmpty(v)) return null;
      return { key: f.id, label: f.label, value: formatFieldValue(f.type, v) };
    })
    .filter((r): r is { key: string; label: string; value: string } => r != null && r.value !== '');
  return { key: 'geral', title: 'Dados do evento', rows };
}

/** Seções "campanha" (scope project) de um serviço, a partir das respostas. */
export function buildProjectSections(
  service: string,
  label: string,
  answers: BriefingAnswers | null | undefined,
): BriefingViewSection[] {
  const ans = answers || {};
  const rows: BriefingViewSection['rows'] = [];
  getProjectSections(service).forEach((sec) =>
    sec.fields.forEach((f) => {
      const v = ans[f.id];
      if (!isEmpty(v)) {
        const value = formatFieldValue(f.type, v);
        if (value !== '') rows.push({ key: `${service}-${f.id}`, label: f.label, value });
      }
    }),
  );
  return rows.length ? [{ key: `camp-${service}`, title: `${label} — campanha`, rows }] : [];
}

/** Seções "acessos" (scope base) de um serviço — vêm do Briefing Básico. */
export function buildAccessSections(
  service: string,
  label: string,
  access: BriefingAnswers | null | undefined,
): BriefingViewSection[] {
  const ans = access || {};
  const rows: BriefingViewSection['rows'] = [];
  getBaseSections(service).forEach((sec) =>
    sec.fields.forEach((f) => {
      const v = ans[f.id];
      if (!isEmpty(v)) {
        const value = formatFieldValue(f.type, v);
        if (value !== '') rows.push({ key: `${service}-${f.id}`, label: f.label, value });
      }
    }),
  );
  return rows.length
    ? [{ key: `acc-${service}`, title: `${label} — acessos`, tag: 'do Briefing Básico', rows }]
    : [];
}

/**
 * Briefing Básico (apenas os acessos) de um cliente, iterando diretamente as
 * chaves do JSON `access` ({ serviço: { campo: valor } }). NÃO usa mapeamento
 * serviço→setor; as chaves do JSON já são chaves de briefing.
 */
export function buildBasicBriefingSections(
  access: Record<string, BriefingAnswers> | null | undefined,
  serviceLabels: Record<string, string>,
): BriefingViewSection[] {
  const map = access || {};
  const out: BriefingViewSection[] = [];
  for (const service of Object.keys(map)) {
    const label = serviceLabels[service] || service;
    out.push(...buildAccessSections(service, label, map[service]));
  }
  return out;
}

// ── Componente de apresentação ───────────────────────────────────────────────

export default function BriefingReadView({
  sections,
  emptyText = 'Briefing ainda não preenchido.',
}: {
  sections: BriefingViewSection[];
  emptyText?: string;
}) {
  const visible = sections.filter((sec) => sec.rows.length > 0);
  if (visible.length === 0) {
    return <p className={css.empty}>{emptyText}</p>;
  }
  return (
    <div className={css.root}>
      {visible.map((sec) => (
        <div key={sec.key} className={css.section}>
          <div className={css.sectionHead}>
            <span>{sec.title}</span>
            {sec.tag && <span className={css.sectionTag}>{sec.tag}</span>}
          </div>
          {sec.rows.map((r): ReactNode => (
            <div key={r.key} className={css.row}>
              <span className={css.rowLabel}>{r.label}</span>
              <span className={css.rowValue}>{r.value}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
