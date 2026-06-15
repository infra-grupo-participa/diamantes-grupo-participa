import { Suspense } from 'react';
import ResetForm from './reset-form';

export const metadata = { title: 'Redefinir senha — Portal Diamantes' };

export default function ResetPasswordPage() {
  return (
    <main className="auth-wrap">
      <div className="auth-shell">
        <section className="auth-hero">
          <span className="auth-badge">◆ Programa Diamantes</span>
          <div>
            <h1>Esqueceu a senha?</h1>
            <p>Enviaremos um link seguro para você criar uma nova senha.</p>
          </div>
          <span style={{ opacity: 0.8, fontSize: '0.8rem' }}>Grupo Participa</span>
        </section>

        <section className="auth-panel">
          <h2>Redefinir senha</h2>
          <p className="sub">Informe seu e-mail para receber o link de redefinição.</p>
          <Suspense fallback={null}>
            <ResetForm />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
