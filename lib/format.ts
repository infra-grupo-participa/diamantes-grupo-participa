// Helpers de formatação/serviço portados do legado (dashboard.html, admin/*).

export function initials(name?: string | null): string {
  if (!name) return '–';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function firstName(name?: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

export function fmtDate(value?: string | Date | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtRelative(value?: string | Date | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Agora mesmo';
  if (min < 60) return `Há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Há ${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'Ontem';
  if (days < 7) return `Há ${days} dias`;
  return fmtDate(d);
}

export function fmtBRL(value?: number | null): string {
  return (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── Mapa canônico de serviços (portal canonicalService + admin canonicalServiceName) ──
type ServiceMeta = { label: string; color: string; sector: string };

const SERVICE_TABLE: Array<{ test: RegExp; meta: ServiceMeta }> = [
  { test: /tr[áa]fego|an[úu]ncios?\s*pagos?|anuncios_pagos|midia/i, meta: { label: 'Tráfego', color: '#6366f1', sector: 'Gestor de Tráfego' } },
  { test: /hosped|host/i, meta: { label: 'Hospedagem', color: '#0ea5e9', sector: 'Hospedagem' } },
  { test: /web\s*design|paginas|p[áa]ginas/i, meta: { label: 'Páginas', color: '#14b8a6', sector: 'Web Designer' } },
  { test: /edi[çc][ãa]o|video|v[íi]deo|edicao_video/i, meta: { label: 'Edição de Vídeo', color: '#ef4444', sector: 'Editor de Vídeo' } },
  { test: /social|redes/i, meta: { label: 'Social Media', color: '#ec4899', sector: 'Social Media' } },
  { test: /automa[çc][ãa]o|disparos|automacao/i, meta: { label: 'Automação', color: '#f59e0b', sector: 'Automação' } },
  { test: /design\s*gr[áa]fico|designer/i, meta: { label: 'Design', color: '#8b5cf6', sector: 'Designer' } },
  { test: /copy/i, meta: { label: 'Copywriter', color: '#10b981', sector: 'Copywriter' } },
];

export function serviceMeta(raw?: string | null): ServiceMeta {
  const s = (raw ?? '').toString();
  for (const row of SERVICE_TABLE) if (row.test.test(s)) return row.meta;
  return { label: s || 'Serviço', color: '#6b6584', sector: s || 'Serviço' };
}

export function canonicalSector(raw?: string | null): string {
  return serviceMeta(raw).sector;
}

/** Estrelas a partir de score já em escala 0-5 (avaliações são 1-5 desde a migration 038). */
export function stars(score?: number | null): string {
  const n = Math.round((score ?? 0) * 2) / 2; // meio-estrela
  const full = Math.floor(n);
  const half = n - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
}
