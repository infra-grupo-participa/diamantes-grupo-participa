// Helpers visuais compartilhados das telas do operador (ícone por tipo de
// demanda, labels/tags de status, prazos). Porta fiel de operator/assets/*.js.
import type { ReactElement } from 'react';
import type { AssignedDemand, DemandStatus } from '@/lib/api/operator';

export const STATUS_LABEL: Record<string, string> = {
  open: 'Nova',
  in_progress: 'Em andamento',
  review: 'Em revisão',
  done: 'Concluída',
  canceled: 'Cancelada',
};

export const STATUS_TAG: Record<string, string> = {
  open: 'new',
  in_progress: 'in_progress',
  review: 'review',
  done: 'done',
  canceled: 'done',
};

export const STATUS_COLOR: Record<string, string> = {
  open: '#16a34a',
  in_progress: '#F29725',
  review: '#ec4899',
  done: '#6366f1',
};

export type IconClass = 'design' | 'video' | 'web' | 'traf' | 'auto' | 'social';

export function inferIconClass(title?: string | null): IconClass {
  const t = String(title || '').toLowerCase();
  if (/v[ií]deo|edi[cç]?[aã]?o|reels?|youtube|live/.test(t)) return 'video';
  if (/site|web|landing|p[aá]gina|html|wordpress/.test(t)) return 'web';
  if (/tr[áa]fego|ads|meta|google|campanha/.test(t)) return 'traf';
  if (/automa[çc][aã]o|email|fluxo|crm/.test(t)) return 'auto';
  if (/social|instagram|tiktok|post/.test(t)) return 'social';
  return 'design';
}

export function DemandIcon({ cls }: { cls: IconClass }): ReactElement {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (cls) {
    case 'video':
      return (
        <svg {...common}>
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      );
    case 'web':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
    case 'traf':
      return (
        <svg {...common}>
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case 'auto':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case 'social':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <polyline points="3 17 9 11 13 15 21 7" />
          <polyline points="14 7 21 7 21 14" />
        </svg>
      );
  }
}

export function daysUntil(date?: string | null): number | null {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/** Texto de prazo para a lista/detalhe (espelha dueMeta do legado). */
export function dueMeta(d: Pick<AssignedDemand, 'status' | 'ends_at'>): string {
  if (d.status === 'done') return 'Concluída';
  if (!d.ends_at) return 'Sem prazo';
  const dd = daysUntil(d.ends_at);
  if (dd == null) return 'Sem prazo';
  if (dd < 0) return Math.abs(dd) + ' dia(s) atrasada';
  if (dd === 0) return 'Prazo hoje';
  if (dd === 1) return 'Prazo amanhã';
  return dd + ' dias restantes';
}

export function statusLabel(s: DemandStatus | string): string {
  return STATUS_LABEL[s] || s;
}
