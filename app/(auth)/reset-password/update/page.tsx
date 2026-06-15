import UpdateForm from './update-form';

export const metadata = { title: 'Nova senha — Portal Diamantes' };

export default function UpdatePasswordPage() {
  return (
    <main className="auth-wrap">
      <div className="auth-shell">
        <section className="auth-hero">
          <span className="auth-badge">◆ Programa Diamantes</span>
          <div>
            <h1>Criar nova senha</h1>
            <p>Defina a nova senha de acesso ao seu portal.</p>
          </div>
          <span style={{ opacity: 0.8, fontSize: '0.8rem' }}>Grupo Participa</span>
        </section>

        <section className="auth-panel">
          <h2>Nova senha</h2>
          <p className="sub">Escolha uma senha forte com pelo menos 8 caracteres.</p>
          <UpdateForm />
        </section>
      </div>
    </main>
  );
}
