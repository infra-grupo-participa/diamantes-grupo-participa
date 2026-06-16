// lib/briefing-pdf.ts
// Geração client-side do PDF do Briefing do Projeto (porte fiel de generatePDF() em portal/briefing.html).
// jspdf é importado dinamicamente (só carrega no submit) para não inflar o bundle da rota.

export interface PdfUnit {
  group?: string;
  title: string;
  /** Campos preenchidos: { label, value } já formatados para exibição. */
  fields: Array<{ label: string; value: string }>;
}

/** Converte valor cru em string exibível (Sim/Não/vazio). Legado — prefira formatFieldValue. */
export function displayVal(v: unknown): string {
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  if (v == null) return '';
  return String(v);
}

/**
 * E2: formata o valor de um campo do briefing de forma legível e fiel ao tipo,
 * eliminando o "[object Object]" (campos compostos como cartão saíam quebrados).
 *
 * - boolean → Sim/Não · date (YYYY-MM-DD) → dd/mm/aaaa · arrays → "a, b, c"
 * - card → "Bandeira •••• 1234" (+ validade só quando NÃO redigido)
 * - objeto genérico → "chave: valor; ..." (nunca "[object Object]")
 *
 * `redactCard`: omite a validade do cartão. Use TRUE para texto que vira
 * pesquisável/indexável (o briefing_summary vai pra descrição/comentário da task
 * no ClickUp, visível a todo o workspace — LGPD). Use FALSE no PDF confidencial.
 */
export function formatFieldValue(
  type: string | undefined,
  value: unknown,
  opts: { redactCard?: boolean } = {},
): string {
  if (value === true) return 'Sim';
  if (value === false) return 'Não';
  if (value === null || value === undefined || value === '') return '';

  if (type === 'card' && typeof value === 'object') {
    const c = value as { brand?: string; last4?: string; expiry?: string };
    const brand = c.brand ? String(c.brand) : 'Cartão';
    const last4 = c.last4 ? `•••• ${c.last4}` : '';
    const base = [brand, last4].filter(Boolean).join(' ').trim() || 'Cartão informado';
    if (opts.redactCard) return base;
    return c.expiry ? `${base} · venc. ${c.expiry}` : base;
  }

  if (Array.isArray(value)) {
    return value
      .map((v) => formatFieldValue(undefined, v, opts))
      .filter((s) => s !== '')
      .join(', ');
  }

  if (type === 'date' && typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${formatFieldValue(undefined, v, opts)}`)
      .filter((s) => !s.endsWith(': '))
      .join('; ');
  }

  return String(value);
}

/**
 * E2: monta o resumo textual do briefing (briefing_summary) em TEXTO CRU
 * (sem markdown — o ClickUp renderiza literal). Pula campos vazios.
 * Recebe unidades com `value` já formatado (a travessia/resolução fica na página).
 */
export function buildBriefingSummary(
  units: Array<{ group?: string; title: string; fields: Array<{ label: string; value: string }> }>,
): string {
  const blocks: string[] = [];
  for (const u of units) {
    const filled = u.fields.filter((f) => f.value !== '');
    if (!filled.length) continue;
    const head = (u.group ? `${u.group} · ` : '') + u.title;
    const lines = filled.map((f) => `- ${f.label}: ${f.value}`);
    blocks.push(`${head}\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

/** Gera o PDF do briefing e devolve um Blob. (async: carrega jspdf sob demanda) */
export async function generateBriefingPdf(
  servicesLabel: string,
  projectTitle: string,
  units: PdfUnit[],
): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const ORANGE: [number, number, number] = [242, 151, 37];
  const DARK: [number, number, number] = [26, 20, 16];
  const GRAY: [number, number, number] = [90, 82, 74];
  const WHITE: [number, number, number] = [255, 255, 255];
  const pageW = 210, pageH = 297, mL = 18, mR = 18, cW = pageW - mL - mR;
  let y = 0;

  const sf = (s: number, st: 'normal' | 'bold', c?: [number, number, number]) => {
    doc.setFontSize(s);
    doc.setFont('helvetica', st);
    doc.setTextColor(...(c ?? DARK));
  };
  const chk = (n: number) => {
    if (y + n > pageH - 16) { doc.addPage(); y = 20; }
  };

  doc.setFillColor(...ORANGE);
  doc.rect(0, 0, pageW, 48, 'F');
  sf(9, 'normal', WHITE); doc.text('GRUPO PARTICIPA · SERVIÇO DIAMANTE', mL, 12);
  sf(22, 'bold', WHITE); doc.text('BRIEFING DO PROJETO', mL, 27);
  sf(11, 'normal', WHITE); doc.text(servicesLabel, mL, 37);
  y = 58;

  sf(9, 'bold', GRAY); doc.text('EVENTO', mL, y); y += 5;
  sf(13, 'bold', DARK);
  const tl = doc.splitTextToSize(projectTitle, cW) as string[];
  doc.text(tl, mL, y); y += tl.length * 6 + 8;

  units.forEach((u) => {
    if (!u.fields.length) return;
    chk(16);
    doc.setFillColor(248, 245, 240);
    doc.roundedRect(mL, y, cW, 9, 1, 1, 'F');
    sf(10, 'bold', DARK);
    doc.text((u.group ? u.group + ' · ' : '') + u.title, mL + 4, y + 6); y += 13;
    u.fields.forEach((f) => {
      chk(12);
      sf(8, 'bold', GRAY); doc.text(f.label, mL, y + 4); y += 6;
      sf(9, 'normal', DARK);
      const lines = doc.splitTextToSize(f.value, cW) as string[];
      doc.text(lines, mL, y + 3); y += lines.length * 5 + 4;
      doc.setDrawColor(240, 235, 225); doc.setLineWidth(0.2);
      doc.line(mL, y, pageW - mR, y); y += 4;
    });
    y += 4;
  });

  const pc = doc.getNumberOfPages();
  for (let p = 1; p <= pc; p++) {
    doc.setPage(p);
    doc.setFillColor(...ORANGE);
    doc.rect(0, pageH - 10, pageW, 10, 'F');
    sf(7, 'normal', WHITE);
    doc.text('Grupo Participa · Serviço Diamante · Documento confidencial', mL, pageH - 4);
    doc.text('Pág. ' + p + '/' + pc, pageW - mR - 15, pageH - 4);
  }
  return doc.output('blob');
}
