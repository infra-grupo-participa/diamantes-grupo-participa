import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import {
  getGeneralFields,
  getProjectSections,
  validateProjectBriefing,
  type ProjectBriefing,
} from '@/lib/briefing-templates';
import ProjectRatingBanner from '@/components/projetos/ProjectRatingBanner';
import styles from './page.module.css';

export const metadata = { title: 'Meus Projetos — Portal Diamantes' };

type ProjectRow = {
  id: string;
  title: string;
  services: string[] | null;
  briefing: ProjectBriefing | null;
  briefing_status: string | null;
  status: string | null;
  created_at: string;
};

// Tags de serviço (ícone + rótulo + cor) — espelha o mapa do legado projetos.html.
const SERVICE_TAGS: Record<string, { label: string; icon: string; color: string }> = {
  anuncios_pagos: { label: 'Tráfego', icon: '📣', color: '#6366f1' },
  edicao_video: { label: 'Edição', icon: '🎬', color: '#ef4444' },
  paginas: { label: 'Páginas', icon: '💻', color: '#14b8a6' },
  automacao: { label: 'Automação', icon: '⚙️', color: '#f59e0b' },
  // legados (exibição de projetos antigos)
  design_grafico: { label: 'Design Gráfico', icon: '🎨', color: '#8b5cf6' },
  social_media: { label: 'Social Media / Copy', icon: '📱', color: '#ec4899' },
  web_design_automacao: { label: 'Web Design / Automação', icon: '💻', color: '#14b8a6' },
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  briefing: { label: 'Aguardando briefing', cls: styles.badgeBriefing },
  active: { label: 'Ativo', cls: styles.badgeActive },
  completed: { label: 'Concluído', cls: styles.badgeCompleted },
  cancelled: { label: 'Cancelado', cls: styles.badgeCancelled },
};

// Progresso do evento: campos red do bloco geral + seções "project" red dos serviços.
function calcProgress(project: ProjectRow): number {
  const services = Array.isArray(project.services) ? project.services : [];
  const briefing = project.briefing ?? {};
  let total = getGeneralFields().filter((f) => f.priority === 'red').length;
  services.forEach((svc) => {
    getProjectSections(svc).forEach((sec) =>
      sec.fields.forEach((f) => {
        if (f.priority === 'red') total++;
      }),
    );
  });
  if (!total) return 100;
  const { missing } = validateProjectBriefing(services, briefing);
  const filled = Math.max(0, total - missing.length);
  return Math.round((filled / total) * 100);
}

export default async function ProjetosPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, title, services, briefing, briefing_status, status, created_at')
    .order('created_at', { ascending: false });

  const projects = (data ?? []) as ProjectRow[];

  // Contagem de demandas por projeto (RLS já restringe ao cliente).
  const { data: demandRows } = await supabase.from('demands').select('project_id').not('project_id', 'is', null);
  const demandCount = new Map<string, number>();
  (demandRows ?? []).forEach((r) => {
    const pid = (r as { project_id?: string }).project_id;
    if (pid) demandCount.set(pid, (demandCount.get(pid) ?? 0) + 1);
  });

  // Data do evento (campo geral do briefing), se preenchida.
  const eventDateOf = (p: ProjectRow): string | null => {
    const g = (p.briefing?.general ?? p.briefing ?? {}) as Record<string, unknown>;
    const raw = (g.event_date ?? g.eventDate) as string | undefined;
    return raw ? fmtDate(raw) : null;
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1>Meus Projetos</h1>
        <Link className={styles.btnNew} href="/portal/novo-projeto">
          + Novo Projeto
        </Link>
      </div>

      <ProjectRatingBanner />

      <div className={styles.grid}>
        {error ? (
          <div className={styles.empty}>
            <div className={styles.icon}>⚠️</div>
            <h2>Não foi possível carregar seus projetos</h2>
            <p>Ocorreu um erro ao buscar os dados. Atualize a página e tente novamente.</p>
          </div>
        ) : projects.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.icon}>📁</div>
            <h2>Nenhum projeto ainda</h2>
            <p>Crie um projeto para fornecer o contexto completo antes de abrir demandas.</p>
            <Link className={styles.btnNew} href="/portal/novo-projeto">
              + Novo Projeto
            </Link>
          </div>
        ) : (
          projects.map((p) => {
            const services = p.services ?? [];
            const status = STATUS_LABELS[p.status ?? 'briefing'] ?? {
              label: p.status ?? 'Projeto',
              cls: styles.badgeBriefing,
            };
            const submitted = p.briefing_status === 'submitted';
            const pct = calcProgress(p);
            const count = demandCount.get(p.id) ?? 0;
            const evDate = eventDateOf(p);
            // Rascunho → leva ao briefing (preencher); enviado → leva às demandas do evento.
            const href = submitted ? `/portal/demandas?projeto=${p.id}` : `/portal/briefing/${p.id}`;

            return (
              <Link key={p.id} href={href} className={styles.card}>
                <div className={styles.tags}>
                  {services.length === 0 ? (
                    <span className={styles.tag} style={{ borderColor: '#6b6584', color: '#6b6584' }}>
                      Evento
                    </span>
                  ) : (
                    services.map((s) => {
                      const meta = SERVICE_TAGS[s] ?? { label: s, icon: '📋', color: '#6b6584' };
                      return (
                        <span
                          key={s}
                          className={styles.tag}
                          style={{ borderColor: meta.color, color: meta.color }}
                        >
                          <span aria-hidden>{meta.icon}</span>
                          {meta.label}
                        </span>
                      );
                    })
                  )}
                </div>

                <div className={styles.title}>{p.title}</div>
                <div className={styles.meta}>
                  {evDate ? `Evento em ${evDate}` : `Criado em ${fmtDate(p.created_at)}`}
                  {count > 0 ? ` · ${count} demanda${count === 1 ? '' : 's'}` : ''}
                </div>

                <div className={styles.footer}>
                  <span className={`${styles.statusBadge} ${status.cls}`}>{status.label}</span>
                  <div className={styles.right}>
                    {!submitted && (
                      <div className={styles.progressWrap}>
                        <div className={styles.progressBar}>
                          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={styles.progressPct}>{pct}%</span>
                      </div>
                    )}
                    <span
                      className={`${styles.pill} ${submitted ? styles.pillSubmitted : styles.pillDraft}`}
                    >
                      {submitted ? 'Ver demandas →' : '✏️ Preencher briefing'}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
