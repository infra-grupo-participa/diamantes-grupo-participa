import Link from 'next/link';
import { getDashboard, isBaseReady, getPendingProjectBriefing, type DashboardData } from '@/lib/api/portal';
import { firstName, fmtRelative, initials, serviceMeta } from '@/lib/format';

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

// Ícones (inline, traço fino) — cabeçalhos e stats.
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
  const pending = baseReady ? await getPendingProjectBriefing().catch(() => null) : null;
  const name = data.user?.name ?? '';
  const team = data.team ?? [];
  const services = data.services ?? [];
  const activity = data.activity ?? [];
  const activeServices = services.filter((s) => s.status === 'active');
  const since = contractStart(data);

  return (
    <div className="dash">
      {!baseReady && (
        <div className="gate-banner">
          <div>
            <strong>Falta concluir seu Briefing Básico</strong>
            <span>Preencha uma vez só para liberar projetos e demandas.</span>
          </div>
          <Link className="btn-primary" href="/portal/briefing-basico">
            Preencher agora →
          </Link>
        </div>
      )}

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
            <p className="muted">{data.client?.display_name ?? 'Bem-vindo de volta ao seu portal Diamante.'}</p>
          </div>
          <div className="dash-plan">
            <span className="dash-plan-badge">💎 Plano Diamante</span>
            {since && <span className="muted small">Com você desde {since}</span>}
          </div>
        </div>

        <div className="dash-stats">
          <div className="dash-stat">
            <span className="dash-stat-ico ico-violet">{IcoUsers}</span>
            <div>
              <strong>{team.length}</strong>
              <span>{team.length === 1 ? 'Integrante' : 'Integrantes'} na sua equipe</span>
            </div>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-ico ico-accent">{IcoRocket}</span>
            <div>
              <strong>{activeServices.length}</strong>
              <span>{activeServices.length === 1 ? 'Serviço ativo' : 'Serviços ativos'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── BENTO ── */}
      <div className="dash-bento">
        <div className="dash-col">
          {/* CTA principal: demandas */}
          <section className="card dash-demands">
            <span className="dash-demands-ico" aria-hidden>{IcoChat}</span>
            <div className="dash-demands-body">
              <h2>Suas demandas</h2>
              <p>Abra chamados, acompanhe as entregas e converse com sua equipe — tudo em um só lugar.</p>
              <Link className="btn-primary" href={baseReady ? '/portal/demandas' : '/portal/briefing-basico'}>
                {baseReady ? 'Abrir demandas →' : 'Concluir Briefing Básico →'}
              </Link>
            </div>
          </section>

          {/* Atividade recente */}
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

        <div className="dash-col">
          {/* Sua equipe */}
          <section className="card">
            <div className="card-head">
              <h2><span className="card-head-ico">{IcoUsers}</span> Sua equipe</h2>
              {team.length > 0 && <span className="card-head-count">{team.length}</span>}
            </div>
            {team.length === 0 ? (
              <div className="dash-empty">
                <span className="dash-empty-ico">{IcoUsers}</span>
                <p>Estamos montando o time perfeito para você. 💪</p>
              </div>
            ) : (
              <ul className="people">
                {team.map((m, i) => (
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

          {/* Seus serviços */}
          <section className="card">
            <div className="card-head">
              <h2><span className="card-head-ico">{IcoLayers}</span> Seus serviços</h2>
            </div>
            {services.length === 0 ? (
              <div className="dash-empty">
                <span className="dash-empty-ico">{IcoLayers}</span>
                <p>Nenhum serviço ativo no momento.</p>
              </div>
            ) : (
              <ul className="svc-list">
                {services.map((s, i) => {
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
        </div>
      </div>
    </div>
  );
}
