import ResetForm from './reset-form';

export const metadata = { title: 'Redefinir senha — Portal Diamantes' };

export default function ResetPasswordPage() {
  return (
    <main className="auth-wrap">
      <div className="auth-shell">
        <section className="auth-hero">
          <span className="auth-badge">◆ Programa Diamantes</span>
          <div>
            <h1>Redefinir senha</h1>
            <p>Defina uma nova senha de acesso ao seu portal.</p>
          </div>
          <span style={{ opacity: 0.8, fontSize: '0.8rem' }}>Grupo Participa</span>
        </section>

        <section className="auth-panel">
          <h2>Nova senha</h2>
          <p className="sub">Informe seu e-mail e a nova senha.</p>
          <ResetForm />
        </section>
      </div>
    </main>
  );
}
