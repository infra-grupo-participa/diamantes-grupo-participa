import LoginForm from './login-form';

export const metadata = { title: 'Acessar — Portal Diamantes' };

export default function LoginPage() {
  return (
    <main className="auth-wrap">
      <div className="auth-shell">
        <section className="auth-hero">
          <span className="auth-hero-deco" aria-hidden>
            <svg width="100%" height="100%" viewBox="0 0 480 560" preserveAspectRatio="xMidYMid slice" fill="none">
              <rect x="338" y="40" width="78" height="78" rx="14" transform="rotate(45 377 79)" stroke="#fff" strokeOpacity="0.16" strokeWidth="2" />
              <rect x="404" y="150" width="46" height="46" rx="9" transform="rotate(45 427 173)" stroke="#fff" strokeOpacity="0.13" strokeWidth="2" />
              <rect x="300" y="150" width="30" height="30" rx="7" transform="rotate(45 315 165)" stroke="#fff" strokeOpacity="0.12" strokeWidth="2" />
              <rect x="40" y="470" width="60" height="60" rx="12" transform="rotate(45 70 500)" stroke="#fff" strokeOpacity="0.10" strokeWidth="2" />
              <path d="M392 392 Q408 456 470 472 Q408 488 392 552 Q376 488 314 472 Q376 456 392 392 Z" fill="#fff" fillOpacity="0.14" />
              <path d="M120 360 Q126 384 150 390 Q126 396 120 420 Q114 396 90 390 Q114 384 120 360 Z" fill="#fff" fillOpacity="0.10" />
            </svg>
          </span>

          <span className="auth-badge">◆ Programa Diamantes</span>

          <div className="auth-hero-mid">
            <h1>Bem-vindo ao seu portal.</h1>
            <p>
              Acompanhe sua equipe, briefings e demandas em um só lugar — com a agilidade
              que o Grupo Participa entrega.
            </p>
          </div>

          <div className="auth-hero-foot">
            <span className="auth-hero-rule" />
            <div className="auth-hero-tag">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>Transformamos estratégia em resultado, juntos com você.</span>
            </div>
            <span className="auth-hero-copy">Grupo Participa © {new Date().getFullYear()}</span>
          </div>
        </section>

        <section className="auth-panel">
          <span className="auth-panel-brand" aria-hidden>◆ Programa Diamantes</span>
          <h2>Acessar</h2>
          <p className="sub">Entre com seu e-mail e senha.</p>
          <LoginForm />
        </section>
      </div>
    </main>
  );
}
