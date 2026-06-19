import Link from 'next/link';
import {
  getDashboard,
  isBaseReady,
  getPendingProjectBriefing,
  getDashboardExtras,
  type DashboardData,
} from '@/lib/api/portal';
import { firstName, fmtRelative, initials, serviceMeta } from '@/lib/format';
import CountUp from '@/components/ui/CountUp';

export const metadata = { title: 'Início — Portal Diamantes' };

const EVENT_LABELS: Record<string, string> = {
  'user.login': 'Você acessou o portal',
  'user.logout': 'Você saiu do portal',
  'service.added': 'Novo serviço adicionado',
  'service.renewed': 'Serviço renovado',
  'team.assigned': 'Novo integrante na sua equipe',
  'demand.created': 'Nova demanda aberta',
  'demand.done': 'Demanda concluída',
  'base_submitted': 'Briefing Básico enviado',
  'project_created': 'Novo projeto criado',
  'project_briefing_submitted': 'Briefing de projeto enviado',
};

function formatEvent(ev?: string): string {
  if (!ev) return 'Atividade';
  return EVENT_LABELS[ev] ?? ev.replace(/[._]/g, ' ');
}

/** Prazo legível olhando para o futuro (ao contrário de fmtRelative). */
function formatDue(iso: string | null): string {
  if (!iso) return 'sem prazo definido';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'sem prazo definido';
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (days < 0) return `atrasada há ${Math.abs(days)} ${Math.abs(days) === 1 ? 'dia' : 'dias'}`;
  if (days === 0) return 'vence hoje';
  if (days === 1) return 'vence amanhã';
  if (days <= 14) return `vence em ${days} dias`;
  return `vence em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`;
}

function contractStart(d: DashboardData): string | null {
  const p = d.profile ?? {};
  const raw = (p.contractStartedAt ?? p.contract_started_at) as string | undefined;
  if (!raw) return null;
  const date = new Date(raw);
  return isNaN(date.getTime()) ? null : date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

const SVC_ICON: Record<string, string> = {
  'Tráfego': '📣',
  'Edição de Vídeo': '🎬',
  'Páginas': '💻',
  'Hospedagem': '🌐',
  'Social Media': '📱',
  'Automação': '⚙️',
  'Design': '🎨',
  'Copywriter': '✍️',
};

const ATTENTION_META: Record<string, { label: string; cls: string }> = {
  review: { label: 'Aguarda sua aprovação', cls: 'att-review' },
  reply: { label: 'A equipe respondeu', cls: 'att-reply' },
  deadline: { label: 'Prazo próximo', cls: 'att-deadline' },
};

// Ícones (inline, traço fino).
const IcoUsers = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);
const IcoRocket = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></svg>
);
const IcoLayers = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12.83 2.18 8.36 4.18a1 1 0 0 1 0 1.78l-8.36 4.18a2 2 0 0 1-1.66 0L2.81 8.14a1 1 0 0 1 0-1.78l8.36-4.18a2 2 0 0 1 1.66 0Z" /><path d="m22 12.5-9.17 4.59a2 2 0 0 1-1.66 0L2 12.5" /><path d="m22 17.5-9.17 4.59a2 2 0 0 1-1.66 0L2 17.5" /></svg>
);
const IcoClock = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
);
const IcoChat = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>
);
const IcoBolt = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
);
const IcoPlus = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
);
const IcoUser = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
);
const IcoCheck = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);

// Cartões reutilizados nos dois modos (onboarding e completo).
function TeamCard({ team }: { team: DashboardData['team'] }) {
  const list = team ?? [];
  return (
    <section className="card">
      <div className="card-head">
        <h2><span className="card-head-ico">{IcoUsers}</span> Sua equipe</h2>
        {list.length > 0 && <span className="card-head-count">{list.length}</span>}
      </div>
      {list.length === 0 ? (
        <div className="dash-empty">
          <span className="dash-empty-ico">{IcoUsers}</span>
          <p>Estamos montando o time perfeito para você. 💪</p>
        </div>
      ) : (
        <ul className="people">
          {list.map((m, i) => (
            <li key={i}>
              <span
                className="avatar-md"
                style={m.position_color ? { background: `linear-gradient(135deg, ${m.position_color}cc, ${m.position_color})` } : undefined}
              >
                {initials(m.user_name)}
              </span>
              <div className="people-info">
                <strong>{m.user_name ?? '—'}</strong>
                <span className="muted small">{m.position_name ?? 'Equipe'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ServicesCard({ services }: { services: DashboardData['services'] }) {
  const list = services ?? [];
  return (
    <section className="card">
      <div className="card-head">
        <h2><span className="card-head-ico">{IcoRocket}</span> Seus serviços</h2>
      </div>
      {list.length === 0 ? (
        <div className="dash-empty">
          <span className="dash-empty-ico">{IcoRocket}</span>
          <p>Nenhum serviço ativo no momento.</p>
        </div>
      ) : (
        <ul className="svc-list">
          {list.map((s, i) => {
            const meta = serviceMeta(s.service_type);
            const delinquent = s.status === 'delinquent';
            return (
              <li key={i} className="svc-item">
                <span className="svc-ico" style={{ background: `${meta.color}1f`, color: meta.color }}>
                  {SVC_ICON[meta.label] ?? '🔹'}
                </span>
                <span className="svc-name">{meta.label}</span>
                <span className={`svc-status ${delinquent ? 'svc-late' : 'svc-active'}`}>
                  {delinquent ? 'Pagamento pendente' : 'Ativo'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default async function Dashboard() {
  let data: DashboardData;
  try {
    data = await getDashboard();
  } catch {
    return (
      <section className="page">
        <h1>Início</h1>
        <p className="muted">Não foi possível carregar seu painel agora. Recarregue a página.</p>
      </section>
    );
  }

  const baseReady = await isBaseReady();
  const [pending, extras] = await Promise.all([
    baseReady ? getPendingProjectBriefing().catch(() => null) : Promise.resolve(null),
    getDashboardExtras().catch(() => null),
  ]);

  const name = data.user?.name ?? '';
  const team = data.team ?? [];
  const services = data.services ?? [];
  const activity = data.activity ?? [];
  const activeServices = services.filter((s) => s.status === 'active');
  const since = contractStart(data);

  const openDemands = extras ? extras.demands.open + extras.demands.in_progress + extras.demands.review : 0;
  const activeProjects = extras?.projects.active ?? 0;
  const attention = extras?.attention ?? [];

  // Passos do onboarding (só enquanto o Briefing Básico não foi enviado).
  const steps = [
    { done: baseReady, title: 'Preencha o Briefing Básico', desc: 'Uma vez só — libera projetos e demandas.', href: '/portal/briefing-basico', cta: 'Preencher' },
    { done: false, title: 'Crie seu primeiro projeto', desc: 'Diga o que precisa e a equipe começa a trabalhar.', cta: 'Criar projeto' },
    { done: false, title: 'Abra sua primeira demanda', desc: 'Peça ajustes ou novas entregas quando quiser.', cta: 'Abrir demanda' },
  ];

  return (
    <div className="dash">
      {pending && (
        <div className="resume-banner">
          <div className="resume-banner-main">
            <span className="resume-eyebrow">⏳ Briefing em andamento</span>
            <strong>Continue de onde parou: {pending.title}</strong>
            <span className="resume-sub">
              {pending.progress >= 100
                ? 'Está tudo preenchido — falta só enviar para a equipe começar.'
                : `${pending.progress}% preenchido — termine o briefing para a equipe começar a trabalhar.`}
            </span>
            <div className="resume-progress" role="progressbar" aria-valuenow={pending.progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="resume-progress-fill" style={{ width: `${pending.progress}%` }} />
            </div>
          </div>
          <Link className="btn-primary" href={`/portal/briefing/${pending.id}`}>
            Continuar briefing →
          </Link>
        </div>
      )}

      {/* ── HERO ── */}
      <header className="dash-hero">
        <span className="dash-hero-deco" aria-hidden>
          <svg viewBox="0 0 420 220" fill="none" preserveAspectRatio="xMaxYMid slice">
            <rect x="300" y="20" width="64" height="64" rx="12" transform="rotate(45 332 52)" stroke="currentColor" strokeOpacity="0.10" strokeWidth="2" />
            <rect x="360" y="120" width="40" height="40" rx="8" transform="rotate(45 380 140)" stroke="currentColor" strokeOpacity="0.08" strokeWidth="2" />
            <path d="M250 150 q12 40 52 50 q-40 10 -52 50 q-12 -40 -52 -50 q40 -10 52 -50Z" fill="currentColor" fillOpacity="0.05" />
          </svg>
        </span>

        <div className="dash-hero-top">
          <div className="dash-hero-greet">
            <h1>
              Olá, {firstName(name) || 'tudo bem'} <span className="wave">👋</span>
            </h1>
            <p className="muted">{data.client?.display_name ?? 'Bem-vindo ao seu portal Diamante.'}</p>
          </div>
          <div className="dash-plan">
            <span className="dash-plan-badge">💎 Plano Diamante</span>
            {since && <span className="muted small">Com você desde {since}</span>}
          </div>
        </div>

        {/* Stats só fazem sentido quando já há atividade (modo completo). */}
        {baseReady && (
          <div className="dash-stats">
            <div className="dash-stat">
              <span className="dash-stat-ico ico-violet">{IcoUsers}</span>
              <div>
                <strong><CountUp value={team.length} /></strong>
                <span>{team.length === 1 ? 'Integrante' : 'Integrantes'}</span>
              </div>
            </div>
            <div className="dash-stat">
              <span className="dash-stat-ico ico-accent">{IcoChat}</span>
              <div>
                <strong><CountUp value={openDemands} /></strong>
                <span>{openDemands === 1 ? 'Demanda em aberto' : 'Demandas em aberto'}</span>
              </div>
            </div>
            <div className="dash-stat">
              <span className="dash-stat-ico ico-violet">{IcoLayers}</span>
              <div>
                <strong><CountUp value={activeProjects} /></strong>
                <span>{activeProjects === 1 ? 'Projeto ativo' : 'Projetos ativos'}</span>
              </div>
            </div>
            <div className="dash-stat">
              <span className="dash-stat-ico ico-accent">{IcoRocket}</span>
              <div>
                <strong><CountUp value={activeServices.length} /></strong>
                <span>{activeServices.length === 1 ? 'Serviço ativo' : 'Serviços ativos'}</span>
              </div>
            </div>
          </div>
        )}
      </header>

      {!baseReady ? (
        /* ════ MODO ONBOARDING (primeiro acesso) ════ */
        <div className="dash-onb-grid">
          <section className="card onb">
            <div className="onb-head">
              <h2>Vamos começar 🚀</h2>
              <p className="muted">3 passos rápidos e seu portal fica pronto para trabalhar.</p>
            </div>
            <ol className="onb-steps">
              {steps.map((step, i) => {
                const active = !step.done && (i === 0 || steps[i - 1].done);
                const state = step.done ? 'is-done' : active ? 'is-active' : 'is-locked';
                return (
                  <li key={i} className={`onb-step ${state}`}>
                    <span className="onb-num">{step.done ? IcoCheck : i + 1}</span>
                    <div className="onb-step-body">
                      <strong>{step.title}</strong>
                      <span className="muted small">{step.desc}</span>
                    </div>
                    {active && step.href && (
                      <Link className="btn-primary onb-cta" href={step.href}>
                        {step.cta} →
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          <div className="dash-side">
            <ServicesCard services={services} />
            <TeamCard team={team} />
          </div>
        </div>
      ) : (
        /* ════ MODO COMPLETO (já tem briefing) ════ */
        <>
          <nav className="dash-actions" aria-label="Atalhos">
            <Link className="dash-action" href="/portal/demandas">
              <span className="dash-action-ico ico-accent">{IcoPlus}</span>
              <span className="dash-action-txt"><strong>Nova demanda</strong><span>Abra um chamado</span></span>
            </Link>
            <Link className="dash-action" href="/portal/novo-projeto">
              <span className="dash-action-ico ico-violet">{IcoRocket}</span>
              <span className="dash-action-txt"><strong>Novo projeto</strong><span>Comece um briefing</span></span>
            </Link>
            <Link className="dash-action" href="/portal/projetos">
              <span className="dash-action-ico ico-accent">{IcoLayers}</span>
              <span className="dash-action-txt"><strong>Meus projetos</strong><span>Acompanhe entregas</span></span>
            </Link>
            <Link className="dash-action" href="/portal/perfil">
              <span className="dash-action-ico ico-violet">{IcoUser}</span>
              <span className="dash-action-txt"><strong>Meu perfil</strong><span>Dados e preferências</span></span>
            </Link>
          </nav>

          <div className="dash-bento3">
            {/* Coluna 1 — Demandas */}
            <div className="dash-col">
              <section className="card">
                <div className="card-head">
                  <h2><span className="card-head-ico">{IcoBolt}</span> Precisam de você</h2>
                  {attention.length > 0 && <span className="card-head-count">{attention.length}</span>}
                </div>
                {attention.length === 0 ? (
                  <div className="dash-empty">
                    <span className="dash-empty-ico">{IcoBolt}</span>
                    <p>Nada pendente do seu lado. 🎉</p>
                    <span className="muted small">Quando algo precisar da sua atenção, aparece aqui.</span>
                  </div>
                ) : (
                  <ul className="att-list">
                    {attention.map((a) => {
                      const meta = ATTENTION_META[a.reason];
                      return (
                        <li key={a.id}>
                          <Link href={`/portal/demandas?d=${a.id}`}>
                            <span className={`att-tag ${meta.cls}`}>{meta.label}</span>
                            <strong className="att-title">{a.title ?? 'Demanda'}</strong>
                            <span className="muted small">
                              {a.project_title ? `${a.project_title} · ` : ''}
                              {formatDue(a.ends_at)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="card">
                <div className="card-head">
                  <h2><span className="card-head-ico">{IcoClock}</span> Atividade recente</h2>
                </div>
                {activity.length === 0 ? (
                  <div className="dash-empty">
                    <span className="dash-empty-ico">{IcoClock}</span>
                    <p>Sem novidades nos últimos 7 dias.</p>
                    <span className="muted small">Quando houver atualizações, elas aparecem aqui.</span>
                  </div>
                ) : (
                  <ul className="activity">
                    {activity.slice(0, 6).map((a, i) => (
                      <li key={i}>
                        <span className="activity-dot" aria-hidden />
                        <span className="activity-text">{formatEvent(a.event)}</span>
                        <span className="muted small">{fmtRelative(a.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Coluna 2 — Projetos */}
            <div className="dash-col">
              <section className="card">
                <div className="card-head">
                  <h2><span className="card-head-ico">{IcoLayers}</span> Seus projetos</h2>
                  <Link className="card-head-link" href="/portal/projetos">Ver todos →</Link>
                </div>
                {!extras || extras.projects.total === 0 ? (
                  <div className="dash-empty">
                    <span className="dash-empty-ico">{IcoLayers}</span>
                    <p>Você ainda não tem projetos.</p>
                    <Link className="btn-soft" href="/portal/novo-projeto">Criar primeiro projeto →</Link>
                  </div>
                ) : (
                  <div className="proj-mini">
                    <div className="proj-mini-item">
                      <strong>{extras.projects.active}</strong>
                      <span>Em andamento</span>
                    </div>
                    <div className="proj-mini-item">
                      <strong>{extras.projects.completed}</strong>
                      <span>Concluídos</span>
                    </div>
                    <div className="proj-mini-item">
                      <strong>{extras.projects.total}</strong>
                      <span>No total</span>
                    </div>
                  </div>
                )}
              </section>

              <ServicesCard services={services} />
            </div>

            {/* Coluna 3 — Equipe */}
            <div className="dash-col">
              <TeamCard team={team} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
