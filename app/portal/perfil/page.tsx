'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getMe,
  updateMe,
  getPreferences,
  setPreferences,
  changePassword,
  uploadAvatar,
  removeAvatar,
  DEFAULT_PREFS,
  type MeProfile,
  type UserPreferences,
} from '@/lib/api/perfil';
import { initials } from '@/lib/format';
import { toast } from '@/lib/toast';
import { translateAuthError, LOCALES } from '@/lib/i18n';
import { usePrefs, syncPrefsFromServer, type ThemePref } from '@/lib/theme';
import styles from './page.module.css';

interface FormState {
  name: string;
  phone: string;
  job_role: string;
  company: string;
  location: string;
  bio: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  phone: '',
  job_role: '',
  company: '',
  location: '',
  bio: '',
};

const NOTIFY_FIELDS: {
  key: keyof UserPreferences;
  title: string;
  desc: string;
}[] = [
  { key: 'notify_messages', title: 'Novas mensagens', desc: 'Quando sua equipe te responde no chat.' },
  { key: 'notify_demand_update', title: 'Atualizações de demanda', desc: 'Quando algo muda em uma demanda sua.' },
  { key: 'notify_deadlines', title: 'Prazos e entregas', desc: 'Lembretes na véspera do prazo.' },
  { key: 'notify_weekly_digest', title: 'Resumo semanal', desc: 'Recebido toda segunda às 9h por e-mail.' },
  { key: 'notify_news', title: 'Novidades do Diamantes', desc: 'Recursos novos, dicas e eventos.' },
];

const TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'São Paulo (GMT-3)' },
  { value: 'America/Manaus', label: 'Manaus (GMT-4)' },
  { value: 'Europe/Lisbon', label: 'Lisboa (GMT+0)' },
];
const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'auto', label: 'Automático' },
];

export default function PerfilPage() {
  const { setTheme, setTimezone, setLocale } = usePrefs();
  const [me, setMe] = useState<MeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [snapshot, setSnapshot] = useState<FormState>(EMPTY_FORM);
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFS);
  const [pwOpen, setPwOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const avatarUrl = me?.metadata?.avatar_url ?? null;
  const isDirty = (Object.keys(form) as (keyof FormState)[]).some((k) => form[k] !== snapshot[k]);

  function hydrate(profile: MeProfile) {
    const meta = profile.metadata ?? {};
    const next: FormState = {
      name: profile.name ?? '',
      phone: meta.phone ?? '',
      job_role: meta.job_role ?? '',
      company: meta.company ?? '',
      location: meta.location ?? '',
      bio: meta.bio ?? '',
    };
    setMe(profile);
    setForm(next);
    setSnapshot(next);
  }

  useEffect(() => {
    (async () => {
      try {
        const profile = await getMe();
        if (profile) hydrate(profile);
        const p = await getPreferences();
        setPrefs(p);
        // Alinha o app (tema/fuso/idioma aplicados) com o que está salvo no banco.
        syncPrefsFromServer({ theme: p.theme, timezone: p.timezone, language: p.language });
      } catch (err) {
        toast(translateAuthError(err as { message?: string }) || 'Erro ao carregar perfil.', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function setField<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateMe({
        name: form.name.trim(),
        metadata: {
          phone: form.phone.trim(),
          job_role: form.job_role.trim(),
          company: form.company.trim(),
          location: form.location.trim(),
          bio: form.bio.trim(),
        },
      });
      const fresh = await getMe();
      if (fresh) hydrate(fresh);
      toast('Tudo salvo');
    } catch (err) {
      toast((err as Error).message || 'Não foi possível salvar.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function onDiscard() {
    setForm(snapshot);
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarBusy(true);
    try {
      await uploadAvatar(file);
      const fresh = await getMe();
      if (fresh) hydrate(fresh);
      toast('Foto atualizada');
    } catch (err) {
      toast((err as Error).message || 'Erro no upload.', 'error');
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onRemoveAvatar() {
    if (!avatarUrl) return;
    if (!confirm('Remover sua foto de exibição?')) return;
    setAvatarBusy(true);
    try {
      await removeAvatar();
      const fresh = await getMe();
      if (fresh) hydrate(fresh);
      toast('Foto removida');
    } catch (err) {
      toast((err as Error).message || 'Erro ao remover.', 'error');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function persistPref(patch: Partial<UserPreferences>) {
    const previous = prefs;
    setPrefs((p) => ({ ...p, ...patch }));
    try {
      await setPreferences(patch);
      toast('Preferência salva');
    } catch (err) {
      setPrefs(previous);
      toast((err as Error).message || 'Não foi possível salvar.', 'error');
    }
  }

  // Aplica a preferência na hora (provider) e salva no banco.
  function onPickTheme(value: string) {
    setTheme(value as ThemePref);
    persistPref({ theme: value });
  }
  function onPickTimezone(value: string) {
    setTimezone(value);
    persistPref({ timezone: value });
  }
  function onPickLanguage(value: string) {
    setLocale(value);
    persistPref({ language: value });
  }

  const avatarStyle = avatarUrl
    ? { background: `url('${avatarUrl}') center/cover no-repeat` }
    : undefined;
  const bioPreview = form.bio.trim() || 'Sem descrição ainda.';

  if (loading) {
    return (
      <div className={styles.wrap}>
        <div className={styles.head}>
          <div>
            <div className={`${styles.skel} ${styles.skelLine}`} style={{ width: 180, height: 26 }} />
            <div className={`${styles.skel} ${styles.skelLine}`} style={{ width: 320, marginTop: 10 }} />
          </div>
        </div>
        <div className={styles.skelGrid}>
          <div className={styles.col}>
            <section className="card">
              <div className={styles.skelRow}>
                <div className={`${styles.skel} ${styles.skelAvatar}`} />
                <div style={{ flex: 1 }}>
                  <div className={`${styles.skel} ${styles.skelLine}`} style={{ width: '50%' }} />
                  <div className={`${styles.skel} ${styles.skelLine}`} style={{ width: '70%', marginTop: 10 }} />
                </div>
              </div>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={`${styles.skel} ${styles.skelLine}`} style={{ height: 40, marginTop: 12 }} />
              ))}
            </section>
            <section className="card">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={`${styles.skel} ${styles.skelLine}`} style={{ height: 32, marginTop: 12 }} />
              ))}
            </section>
          </div>
          <div className={styles.col}>
            <section className="card">
              <div className={`${styles.skel} ${styles.skelLine}`} style={{ width: '60%', height: 40 }} />
            </section>
            <section className="card">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={`${styles.skel} ${styles.skelLine}`} style={{ height: 32, marginTop: 12 }} />
              ))}
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h1>Meus dados</h1>
          <p className="sub" style={{ color: 'var(--muted)', margin: '6px 0 0' }}>
            Gerencie suas informações pessoais, preferências e configurações da conta.
          </p>
        </div>
      </div>

      <div className={styles.grid}>
        {/* ── COLUNA ESQUERDA ── */}
        <div className={styles.col}>
          {/* Informações pessoais */}
          <section className="card">
            <div className={styles.cardHead}>
              <h2>Informações pessoais</h2>
              <div className="sub" style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: 4 }}>
                Como você prefere ser identificado por aqui.
              </div>
            </div>

            <div className={styles.avatarRow}>
              <div className={styles.avatarBig} style={avatarStyle}>
                {!avatarUrl && initials(form.name)}
              </div>
              <div className={styles.avatarInfo}>
                <div className={styles.avatarName}>{form.name || '—'}</div>
                <div className={styles.avatarSubtitle}>Sua foto de exibição.</div>
                <div className={styles.avatarButtons}>
                  <button
                    type="button"
                    className={styles.btnGhost}
                    disabled={avatarBusy}
                    onClick={() => fileRef.current?.click()}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width="14"
                      height="14"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Alterar foto
                  </button>
                  <button
                    type="button"
                    className={`${styles.btnGhost} ${styles.btnGhostDanger}`}
                    disabled={avatarBusy || !avatarUrl}
                    onClick={onRemoveAvatar}
                  >
                    Remover
                  </button>
                </div>
                <div className={styles.avatarHint}>JPG, PNG ou GIF. Máx. 2 MB.</div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,.jpg,.jpeg,.png,.gif"
                  hidden
                  onChange={onPickAvatar}
                />
              </div>
            </div>

            <form onSubmit={onSubmit}>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label htmlFor="fName">Nome completo</label>
                  <input
                    id="fName"
                    type="text"
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="fEmail">E-mail</label>
                  <input id="fEmail" type="email" value={me?.email ?? ''} readOnly />
                  <span className="hint" style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                    Esse é o e-mail vinculado à sua conta — não pode ser alterado por aqui.
                  </span>
                </div>
                <div className={styles.field}>
                  <label htmlFor="fPhone">Celular</label>
                  <input
                    id="fPhone"
                    type="tel"
                    value={form.phone}
                    placeholder="(00) 00000-0000"
                    onChange={(e) => setField('phone', e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="fRole">Cargo / função</label>
                  <input
                    id="fRole"
                    type="text"
                    value={form.job_role}
                    onChange={(e) => setField('job_role', e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="fCompany">Empresa</label>
                  <input
                    id="fCompany"
                    type="text"
                    value={form.company}
                    onChange={(e) => setField('company', e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="fLocation">Cidade — UF</label>
                  <input
                    id="fLocation"
                    type="text"
                    value={form.location}
                    placeholder="São Paulo — SP"
                    onChange={(e) => setField('location', e.target.value)}
                  />
                </div>
                <div className={`${styles.field} ${styles.full}`}>
                  <label htmlFor="fBio">Sobre você</label>
                  <textarea
                    id="fBio"
                    value={form.bio}
                    onChange={(e) => setField('bio', e.target.value)}
                  />
                  <span className="hint" style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                    Sua equipe vê isso ao iniciar uma demanda. Conte rapidamente o que faz e o que valoriza.
                  </span>
                </div>
              </div>
              <div className={styles.saveRow}>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={onDiscard}
                  disabled={saving || !isDirty}
                >
                  Descartar
                </button>
                <button type="submit" className="btn-primary" disabled={saving || !isDirty}>
                  {saving ? 'Salvando…' : 'Salvar alterações'}
                </button>
              </div>
            </form>
          </section>

          {/* Segurança da conta */}
          <section className="card">
            <div className={styles.cardHead}>
              <h2>Segurança da conta</h2>
              <div className="sub" style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: 4 }}>
                Mantenha sua conta protegida.
              </div>
            </div>

            <div className={styles.listRow}>
              <div className={styles.ico}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div>
                <div className={styles.rowTitle}>Senha</div>
                <div className={styles.rowDesc}>Defina uma nova senha de acesso.</div>
              </div>
              <button type="button" className={styles.rowAction} onClick={() => setPwOpen(true)}>
                Alterar senha
              </button>
            </div>

            <div className={styles.listRow}>
              <div className={styles.ico}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <div className={styles.rowTitle}>Sessões ativas</div>
                <div className={styles.rowDesc}>
                  Por enquanto, saia da conta pelo menu do usuário. A lista de dispositivos chega em breve.
                </div>
              </div>
              <span className={styles.soon}>Em breve</span>
            </div>

            <div className={styles.listRow}>
              <div className={`${styles.ico} ${styles.icoDanger}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                </svg>
              </div>
              <div>
                <div className={styles.rowTitle}>Encerrar conta</div>
                <div className={styles.rowDesc}>
                  Para encerrar sua conta, fale com seu contato no Diamantes. O autoatendimento chega em breve.
                </div>
              </div>
              <span className={styles.soon}>Em breve</span>
            </div>
          </section>

          {/* Informações de assinatura */}
          <section className="card">
            <div className={styles.cardHead}>
              <h2>Informações da assinatura</h2>
              <div className="sub" style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: 4 }}>
                Seu plano e relação com a gente.
              </div>
            </div>
            <div className={styles.planCard}>
              <div className={styles.planIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 3h12l4 6-10 12L2 9z" />
                </svg>
              </div>
              <div>
                <div className={styles.planName}>Plano Diamante</div>
                <div className={styles.planSince}>
                  {me?.client_slug ? 'Cliente do portal' : '—'}
                </div>
              </div>
              <span className={styles.soon}>Em breve</span>
            </div>
          </section>
        </div>

        {/* ── COLUNA DIREITA ── */}
        <div className={styles.col}>
          {/* Sobre você */}
          <section className="card">
            <div className={styles.cardHead}>
              <h2>Sobre você</h2>
              <div className="sub" style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: 4 }}>
                O que sua equipe lê primeiro.
              </div>
            </div>
            <p className={styles.aboutPreview}>{bioPreview}</p>
          </section>

          {/* Notificações */}
          <section className="card">
            <div className={styles.cardHead}>
              <h2>Notificações</h2>
              <div className="sub" style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: 4 }}>
                Avisamos por aqui sempre que algo acontecer.
              </div>
            </div>
            {NOTIFY_FIELDS.map((f) => (
              <label key={f.key} className={styles.toggleRow}>
                <div>
                  <div className={styles.toggleTitle}>{f.title}</div>
                  <div className={styles.toggleDesc}>{f.desc}</div>
                </div>
                <span className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={Boolean(prefs[f.key])}
                    onChange={(e) => persistPref({ [f.key]: e.target.checked } as Partial<UserPreferences>)}
                  />
                  <span className={styles.slider} />
                </span>
              </label>
            ))}
          </section>

          {/* Preferências */}
          <section className="card">
            <div className={styles.cardHead}>
              <h2>Preferências</h2>
              <div className="sub" style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: 4 }}>
                Pequenos ajustes pessoais.
              </div>
            </div>

            <div className={styles.prefRow}>
              <div>
                <div className={styles.prefTitle}>Idioma</div>
                <div className={styles.prefDesc}>
                  Hoje o portal está só em português.{' '}
                  <span className={styles.prefSoon}>Outros idiomas em breve.</span>
                </div>
              </div>
              <select value={prefs.language} onChange={(e) => onPickLanguage(e.target.value)}>
                {LOCALES.map((o) => (
                  <option key={o.code} value={o.code} disabled={!o.ready}>
                    {o.label}
                    {o.ready ? '' : ' (em breve)'}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.prefRow}>
              <div>
                <div className={styles.prefTitle}>Fuso horário</div>
                <div className={styles.prefDesc}>Datas e horários no portal.</div>
              </div>
              <select value={prefs.timezone} onChange={(e) => onPickTimezone(e.target.value)}>
                {TIMEZONES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.prefRow}>
              <div>
                <div className={styles.prefTitle}>Tema</div>
                <div className={styles.prefDesc}>Claro, escuro ou seguir o sistema.</div>
              </div>
              <select value={prefs.theme} onChange={(e) => onPickTheme(e.target.value)}>
                {THEMES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </section>
        </div>
      </div>

      {pwOpen && <PasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Modal de troca de senha (type=password + confirmação)
// ─────────────────────────────────────────────────────────────

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (pw.length < 8) {
      setError('A senha precisa ter no mínimo 8 caracteres.');
      return;
    }
    if (pw !== confirmPw) {
      setError('As senhas não conferem.');
      return;
    }
    setBusy(true);
    try {
      await changePassword(pw);
      toast('Senha alterada');
      onClose();
    } catch (err) {
      setError(translateAuthError(err as { message?: string }) || 'Não foi possível alterar a senha.');
      setBusy(false);
    }
  }

  return (
    <div
      className={styles.overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className={styles.dialog}>
        <div className={styles.dialogHead}>
          <div>
            <h3>Alterar senha</h3>
            <div className={styles.dialogSub}>Escolha uma nova senha de acesso.</div>
          </div>
          <button type="button" className={styles.dialogClose} onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <form className={styles.dialogBody} onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor="pwNew">Nova senha</label>
            <input
              id="pwNew"
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Mín. 8 caracteres"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="pwConfirm">Confirmar nova senha</label>
            <input
              id="pwConfirm"
              type="password"
              autoComplete="new-password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Repita a senha"
            />
          </div>
          {error && <p className={styles.formError}>{error}</p>}
          <div className={styles.dialogActions}>
            <button type="button" className={styles.btnGhost} onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar senha'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
