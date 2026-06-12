'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getMe,
  getDashboard,
  listPositions,
  listMyStudents,
  listMyRatings,
  updateMe,
  changePassword,
  uploadAvatar,
  type OperatorProfile,
  type OperatorDashboard,
  type Position,
  type ReceivedRating,
} from '@/lib/api/operator';
import { initials } from '@/lib/format';
import { toast } from '@/lib/toast';
import s from './perfil.module.css';

const GRADIENTS: [string, string][] = [
  ['#fde68a', '#f59e0b'],
  ['#bae6fd', '#0284c7'],
  ['#f5d0fe', '#a855f7'],
  ['#fecaca', '#ef4444'],
  ['#bbf7d0', '#16a34a'],
  ['#c7d2fe', '#6366f1'],
];
function gradientFor(name?: string | null): [string, string] {
  const str = String(name || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

function fmtScore(score?: number | null): string {
  if (score == null) return '—';
  const n = Number(score);
  if (!isFinite(n)) return '—';
  return n.toFixed(2).replace('.', ',');
}

/** Estrelas a partir de score 0-10 (escala do legado: arredonda /10*5). */
function starString(scoreOutOf10?: number | null): string {
  if (scoreOutOf10 == null) return '☆ ☆ ☆ ☆ ☆';
  const stars5 = Math.round((Number(scoreOutOf10) / 10) * 5);
  return '★'.repeat(stars5) + '☆'.repeat(Math.max(0, 5 - stars5));
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function OperatorPerfil() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<OperatorProfile | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [dash, setDash] = useState<OperatorDashboard>({});
  const [studentsCount, setStudentsCount] = useState(0);
  const [reviews, setReviews] = useState<ReceivedRating[]>([]);

  // Form state
  const [fName, setFName] = useState('');
  const [fWhatsapp, setFWhatsapp] = useState('');
  const [fBio, setFBio] = useState('');
  const [fPosition, setFPosition] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Modal de senha
  const [showPass, setShowPass] = useState(false);
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);

  function syncForm(profile: OperatorProfile | null) {
    setFName(profile?.name || '');
    setFWhatsapp((profile?.metadata?.whatsapp as string) || '');
    setFBio((profile?.metadata?.bio as string) || '');
    setFPosition(profile?.position_id != null ? String(profile.position_id) : '');
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meRow = await getMe().catch(() => null);
      const [pos, d, students, ratings] = await Promise.all([
        listPositions().catch((e) => {
          console.error(e);
          return [] as Position[];
        }),
        getDashboard().catch((e) => {
          console.error(e);
          return {} as OperatorDashboard;
        }),
        listMyStudents().catch((e) => {
          console.error(e);
          return [];
        }),
        listMyRatings(50).catch((e) => {
          console.error(e);
          return [] as ReceivedRating[];
        }),
      ]);
      if (cancelled) return;
      setMe(meRow);
      setPositions(pos);
      setDash(d);
      setStudentsCount(students.length);
      setReviews(ratings);
      syncForm(meRow);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    const name = fName.trim();
    if (!name) {
      toast('Nome obrigatório.', 'error');
      return;
    }
    setSaving(true);
    try {
      await updateMe({
        name,
        position_id: fPosition ? Number(fPosition) : null,
        metadata: {
          whatsapp: fWhatsapp.trim() || null,
          bio: fBio.trim() || null,
        },
      });
      const fresh = await getMe();
      setMe(fresh);
      syncForm(fresh);
      toast('Alterações salvas.', 'success');
    } catch (e) {
      toast('Erro ao salvar: ' + ((e as Error).message || e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await uploadAvatar(f);
      const fresh = await getMe();
      setMe(fresh);
      toast('Foto atualizada.', 'success');
    } catch (err) {
      toast('Falha no upload: ' + ((err as Error).message || err), 'error');
    } finally {
      e.target.value = '';
    }
  }

  async function handleChangePassword() {
    if (pass1 !== pass2) {
      toast('Senhas não conferem.', 'error');
      return;
    }
    setSavingPass(true);
    try {
      await changePassword(pass1);
      toast('Senha alterada.', 'success');
      setShowPass(false);
      setPass1('');
      setPass2('');
    } catch (e) {
      toast((e as Error).message || String(e), 'error');
    } finally {
      setSavingPass(false);
    }
  }

  if (loading) {
    return (
      <div className={s.wrap}>
        <div className={s.pageHead}>
          <div className={`${s.sk} ${s.skLine}`} style={{ width: 180, height: 24 }} />
          <div className={`${s.sk} ${s.skLine}`} style={{ width: 320, marginTop: 8 }} />
        </div>
        <div className={`${s.sk} ${s.skHero}`} />
        <div className={s.grid2}>
          <div className={`${s.sk} ${s.skCard}`} />
          <div className={`${s.sk} ${s.skCard}`} />
        </div>
        <div className={`${s.sk} ${s.skCard}`} />
      </div>
    );
  }

  const kpi = dash.kpi || {};
  const avatarUrl = me?.metadata?.avatar_url as string | undefined;
  const [ga, gb] = gradientFor(me?.name || 'OP');
  const positionName = positions.find((p) => p.id === me?.position_id)?.name;
  const member = me?.created_at ? `Membro desde ${fmtDate(me.created_at)}` : '';
  const ratingTotal = kpi.rating_count || 0;

  return (
    <div className={s.wrap}>
      <div className={s.pageHead}>
        <h1>Meu perfil</h1>
        <p className={s.sub}>Suas informações pessoais, cargos e desempenho no atendimento.</p>
      </div>

      <section className={s.hero}>
        <div
          className={`${s.bigAvatar} ${avatarUrl ? s.hasImage : ''}`}
          style={{
            background: avatarUrl
              ? `url('${avatarUrl}') center/cover no-repeat`
              : `linear-gradient(135deg,${ga},${gb})`,
          }}
          onClick={() => avatarInputRef.current?.click()}
        >
          {!avatarUrl && <span>{initials(me?.name)}</span>}
          <span className={s.avatarOverlay}>Trocar foto</span>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatar}
          />
        </div>
        <div>
          <h2 className={s.heroName}>{me?.name || '—'}</h2>
          <div className={s.roleLine}>
            {me?.email || ''}
            {member ? ' • ' + member : ''}
          </div>
          <div className={s.roleTags}>
            {positionName && <span className={s.roleTag}>{positionName}</span>}
          </div>
        </div>
        <div className={s.actions}>
          <button className="btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>
          <button className="btn-secondary" onClick={() => setShowPass(true)}>
            Trocar senha
          </button>
        </div>
      </section>

      <div className={s.grid2}>
        <div className={s.card}>
          <h2>Dados pessoais</h2>
          <div className={s.formGrid}>
            <div className={s.field}>
              <label>Nome completo</label>
              <input type="text" value={fName} onChange={(e) => setFName(e.target.value)} />
            </div>
            <div className={s.field}>
              <label>E-mail</label>
              <input type="email" value={me?.email || ''} disabled />
            </div>
            <div className={s.field}>
              <label>WhatsApp</label>
              <input
                type="text"
                placeholder="(11) 99999-9999"
                value={fWhatsapp}
                onChange={(e) => setFWhatsapp(e.target.value)}
              />
            </div>
            <div className={s.field}>
              <label>Cargo principal</label>
              <select value={fPosition} onChange={(e) => setFPosition(e.target.value)}>
                <option value="">— sem cargo —</option>
                {positions.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${s.field} ${s.fieldFull}`}>
              <label>Bio / Apresentação</label>
              <textarea
                rows={3}
                placeholder="Conte um pouco sobre você e seu trabalho..."
                value={fBio}
                onChange={(e) => setFBio(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className={s.card}>
          <h2>Desempenho no mês</h2>
          <div className={s.statsGrid}>
            <div className={`${s.statTile} ${s.green}`}>
              <div className={s.ico}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div>
                <div className={s.statNum}>{kpi.done_today_count ?? 0}</div>
                <div className={s.statLbl}>Concluídas hoje</div>
              </div>
            </div>
            <div className={`${s.statTile} ${s.orange}`}>
              <div className={s.ico}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div>
                <div className={s.statNum}>{kpi.in_progress_count ?? 0}</div>
                <div className={s.statLbl}>Em execução</div>
              </div>
            </div>
            <div className={`${s.statTile} ${s.indigo}`}>
              <div className={s.ico}>
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <div>
                <div className={s.statNum}>{fmtScore(kpi.rating_avg)}</div>
                <div className={s.statLbl}>Nota média</div>
              </div>
            </div>
            <div className={`${s.statTile} ${s.pink}`}>
              <div className={s.ico}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div>
                <div className={s.statNum}>{studentsCount}</div>
                <div className={s.statLbl}>Alunos atendidos</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className={s.card}>
        <h2>Avaliações dos alunos</h2>
        <div className={s.ratingSummary}>
          <div>
            <div className={s.ratingNum}>{fmtScore(kpi.rating_avg)}</div>
            <div className={s.ratingCount}>
              {ratingTotal === 0
                ? 'Sem avaliações ainda'
                : `Baseado em ${ratingTotal} avaliação${ratingTotal === 1 ? '' : 'ões'}`}
            </div>
          </div>
          <div>
            <div className={s.ratingStars}>{starString(kpi.rating_avg)}</div>
            <div className={s.ratingCount}>Histórico completo</div>
          </div>
        </div>
        <div>
          {reviews.length === 0 ? (
            <div className={s.empty}>
              Quando seus alunos avaliarem demandas, as notas aparecem aqui.
            </div>
          ) : (
            reviews.map((r) => {
              const [a, b] = gradientFor(r.client_display_name);
              return (
                <div className={s.reviewRow} key={r.id}>
                  <div className={s.reviewAv} style={{ background: `linear-gradient(135deg,${a},${b})` }}>
                    {initials(r.client_display_name)}
                  </div>
                  <div>
                    <div className={s.reviewHead}>
                      <div className={s.reviewName}>{r.client_display_name}</div>
                      <div className={s.reviewStars}>
                        {starString(r.score)}{' '}
                        <span style={{ color: 'var(--muted)', fontWeight: 500, marginLeft: 6 }}>
                          ({fmtScore(r.score)})
                        </span>
                      </div>
                    </div>
                    {r.comment && <div className={s.reviewComment}>&quot;{r.comment}&quot;</div>}
                    <div className={s.reviewWhen}>{fmtDate(r.created_at)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {showPass && (
        <div className={s.modalBackdrop} onClick={(e) => { if (e.target === e.currentTarget) setShowPass(false); }}>
          <div className={s.modalCard}>
            <h3>Trocar senha</h3>
            <div className={s.modalSub}>Mínimo de 8 caracteres. Confirme abaixo.</div>
            <div className={s.field} style={{ marginBottom: 10 }}>
              <label>Nova senha</label>
              <input
                type="password"
                autoComplete="new-password"
                value={pass1}
                onChange={(e) => setPass1(e.target.value)}
              />
            </div>
            <div className={s.field}>
              <label>Confirmar nova senha</label>
              <input
                type="password"
                autoComplete="new-password"
                value={pass2}
                onChange={(e) => setPass2(e.target.value)}
              />
            </div>
            <div className={s.modalActions}>
              <button className="btn-secondary" onClick={() => setShowPass(false)}>
                Cancelar
              </button>
              <button className="btn-primary" disabled={savingPass} onClick={handleChangePassword}>
                {savingPass ? 'Salvando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
