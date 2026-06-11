import LoginForm from './login-form';

export const metadata = { title: 'Acessar — Portal Diamantes' };

export default function LoginPage() {
  return (
    <main className="auth-wrap">
      <div className="auth-shell">
        <section className="auth-hero">
          <span className="auth-badge">◆ Programa Diamantes</span>
          <div>
            <h1>Bem-vindo ao seu portal.</h1>
            <p>
              Acompanhe sua equipe, briefings e demandas em um só lugar — com a agilidade
              que o Grupo Participa entrega.
            </p>
          </div>
          <span style={{ opacity: 0.8, fontSize: '0.8rem' }}>Grupo Participa © {new Date().getFullYear()}</span>
        </section>

        <section className="auth-panel">
          <h2>Acessar</h2>
          <p className="sub">Entre com seu e-mail e senha.</p>
          <LoginForm />
        </section>
      </div>
    </main>
  );
}
