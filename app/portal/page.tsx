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
            <div
              className="resume-progress"
              role="progressbar"
              aria-valuenow={pending.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="resume-progress-fill" style={{ width: `${pending.progress}%` }} />
            </div>
          </div>
          <Link className="btn-primary" href={`/portal/briefing/${pending.id}`}>
            Continuar briefing →
          </Link>
        </div>
      )}

      <header className="dash-hero">
        <div>
          <h1>
            Olá, {firstName(name) || 'tudo bem'} <span className="wave">👋</span>
          </h1>
          <p className="muted">{data.client?.display_name ?? 'Bem-vindo ao seu portal Diamante.'}</p>
        </div>
        <div className="dash-badges">
          <span className="badge badge-warning">💎 Diamante</span>
          {since && <span className="muted small">Com você desde {since}</span>}
        </div>
      </header>

      <div className="dash-pills">
        <div className="pill">
          <strong>{team.length}</strong>
          <span>Integrantes</span>
        </div>
        <div className="pill">
          <strong>{activeServices.length}</strong>
          <span>Serviços ativos</span>
        </div>
      </div>

      <div className="dash-grid">
        <section className="card">
          <h2>Sua equipe</h2>
          {team.length === 0 ? (
            <p className="muted">Estamos montando o time perfeito para você. 💪</p>
          ) : (
            <ul className="people">
              {team.map((m, i) => (
                <li key={i}>
                  <span className="avatar-md" style={{ background: m.position_color ?? '#6b6584' }}>
                    {initials(m.user_name)}
                  </span>
                  <div>
                    <strong>{m.user_name ?? '—'}</strong>
                    <span className="muted small">{m.position_name ?? 'Equipe'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Seus serviços</h2>
          {services.length === 0 ? (
            <p className="muted">Nenhum serviço ativo no momento.</p>
          ) : (
            <div className="chips">
              {services.map((s, i) => {
                const meta = serviceMeta(s.service_type);
                const delinquent = s.status === 'delinquent';
                return (
                  <span
                    key={i}
                    className="svc-chip"
                    style={{ borderColor: meta.color, color: delinquent ? 'var(--danger)' : meta.color }}
                  >
                    {meta.label}
                    {delinquent && <small> · aguardando pagamento</small>}
                  </span>
                );
              })}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Atividade recente</h2>
          {activity.length === 0 ? (
            <p className="muted">Sem novidades nos últimos 7 dias.</p>
          ) : (
            <ul className="activity">
              {activity.slice(0, 6).map((a, i) => (
                <li key={i}>
                  <span>{formatEvent(a.event)}</span>
                  <span className="muted small">{fmtRelative(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card cta-card">
          <h2>Suas demandas</h2>
          <p className="muted">Acompanhe entregas e converse com sua equipe.</p>
          <Link className="btn-primary" href={baseReady ? '/portal/demandas' : '/portal/briefing-basico'}>
            {baseReady ? 'Abrir demandas →' : 'Concluir Briefing Básico →'}
          </Link>
        </section>
      </div>
    </div>
  );
}
