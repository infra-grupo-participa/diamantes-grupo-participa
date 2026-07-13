'use client';

// Modal Nova Demanda — wizard 2 steps (simples × projeto).
// Port de buildNewDemandModal()/ndGoStep2()/ndForm de portal/demandas.html.
// Gate-aware: o caller só abre se isBaseReady().

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createDemand,
  listMyProjects,
  listOperatorsForClient,
  type Demand,
  type Operator,
  type Project,
} from '@/lib/api/demandas';
import {
  ACCEPT_ATTR,
  CHAT_CONFIG,
  MAX_FILES,
  fmtSize,
  isAcceptedFile,
  isImage,
  postMessage,
  uploadAttachment,
  type Attachment,
} from '@/lib/chat';
import { initials } from '@/lib/format';
import { toast } from '@/lib/toast';
import { errMessage } from '@/lib/errors';
import styles from './Modal.module.css';

type Mode = 'simple' | 'project';

// Anexo escolhido na criação: fica só no cliente até a demanda existir — o RLS do
// bucket exige um demand_id real no path, então o upload acontece no submit.
type PickedFile = { id: string; file: File; thumbUrl: string | null };

const IconClip = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);
const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

// Prazo: lógica por DIAS ÚTEIS (pula fim de semana).
// Mínimo = turnaround realista que a equipe consegue cumprir; sugestão = prazo confortável.
const MIN_LEAD_BD = 2; // prazo final mínimo (dias úteis a partir de hoje)
const SUGGESTED_LEAD_BD = 5; // sugestão pré-preenchida (dias úteis)

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++; // ignora domingo(0) e sábado(6)
  }
  return d;
}
function fmtBR(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export default function NewDemandModal({
  onClose,
  onCreated,
  userId,
}: {
  onClose: () => void;
  onCreated: (demand: Demand) => void;
  /** portal.users.id do cliente logado — necessário para postar os anexos no chat. */
  userId: number | null;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<Mode | null>(null);
  const [projectId, setProjectId] = useState<string>('');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [operators, setOperators] = useState<Operator[] | null>(null);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [selectedOps, setSelectedOps] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [dragover, setDragover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Criando…');

  // Datas de referência (estáveis durante a sessão do modal).
  const dateHints = useMemo(() => {
    const today = new Date();
    return {
      todayStr: toYMD(today),
      minEnds: toYMD(addBusinessDays(today, MIN_LEAD_BD)),
      suggestedEnds: toYMD(addBusinessDays(today, SUGGESTED_LEAD_BD)),
    };
  }, []);

  // a11y: fecha no Esc e foca o modal ao abrir.
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Libera as thumbs (object URLs) ao desmontar.
  const filesRef = useRef<PickedFile[]>([]);
  filesRef.current = files;
  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => f.thumbUrl && URL.revokeObjectURL(f.thumbUrl));
    };
  }, []);

  function addFiles(incoming: FileList | File[]) {
    const arr = Array.from(incoming);
    const accepted = arr.filter(isAcceptedFile);
    const rejectedType = arr.length - accepted.length;
    if (rejectedType > 0) {
      toast(
        rejectedType === 1
          ? 'Um arquivo foi ignorado: tipo não suportado.'
          : `${rejectedType} arquivos foram ignorados: tipo não suportado.`,
        'warning',
      );
    }
    const sized = accepted.filter((f) => f.size <= CHAT_CONFIG.MAX_FILE_SIZE);
    if (sized.length < accepted.length) {
      toast(`Arquivo maior que ${fmtSize(CHAT_CONFIG.MAX_FILE_SIZE)} não pode ser anexado.`, 'warning');
    }
    const limit = Math.max(0, MAX_FILES - filesRef.current.length);
    if (sized.length > limit) {
      toast(`Máximo de ${MAX_FILES} anexos. ${sized.length - limit} não foram adicionados.`, 'warning');
    }
    const picked: PickedFile[] = sized.slice(0, limit).map((file) => ({
      id: Math.random().toString(36).slice(2),
      file,
      thumbUrl: isImage(file.type) ? URL.createObjectURL(file) : null,
    }));
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
  }

  function removeFile(id: string) {
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f?.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
      return prev.filter((x) => x.id !== id);
    });
  }

  /** Sobe os anexos e posta como primeira mensagem do chat (o que o sync espelha
   *  na task do ClickUp). Best-effort: a demanda JÁ existe, então uma falha aqui
   *  vira aviso — o cliente reanexa pelo chat — e nunca desfaz a criação. */
  async function uploadPickedFiles(demandId: string) {
    if (!files.length) return;
    if (!userId) {
      toast('Demanda criada, mas os anexos não foram enviados. Anexe pelo chat da demanda.', 'warning');
      return;
    }
    setBusyLabel(files.length === 1 ? 'Enviando anexo…' : 'Enviando anexos…');
    const results = await Promise.allSettled(files.map((f) => uploadAttachment(demandId, f.file)));
    const ok: Attachment[] = [];
    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') ok.push(r.value);
      else failed.push(files[i].file.name);
    });

    if (ok.length) {
      try {
        await postMessage(demandId, '', ok, userId);
      } catch (e) {
        toast('Os arquivos subiram, mas não entraram no chat: ' + errMessage(e), 'error');
        return;
      }
    }
    if (failed.length) {
      toast(
        `Não foi possível anexar ${failed.join(', ')}. Tente enviar pelo chat da demanda.`,
        'error',
      );
    }
  }

  // Ao escolher modo "projeto", carrega projetos active/briefing.
  useEffect(() => {
    if (mode !== 'project' || projects !== null) return;
    let cancel = false;
    setLoadingProjects(true);
    setProjectsError(null);
    listMyProjects()
      .then((all) => {
        if (cancel) return;
        setProjects(all.filter((p) => p.status === 'active' || p.status === 'briefing'));
      })
      .catch((e) => {
        if (cancel) return;
        // Diferencia falha (rede/permissão) de lista vazia: erro NÃO vira "nenhum projeto".
        setProjectsError(e instanceof Error ? e.message : 'Não foi possível carregar os projetos.');
        setProjects(null);
      })
      .finally(() => !cancel && setLoadingProjects(false));
    return () => {
      cancel = true;
    };
  }, [mode, projects]);

  const canNext = mode === 'simple' || (mode === 'project' && !!projectId);

  async function goStep2() {
    if (!canNext) return;
    setStep(2);
    // Sugestão de prazo: pré-preenche o prazo final se o cliente ainda não escolheu.
    if (!endsAt) setEndsAt(dateHints.suggestedEnds);
    if (operators === null) {
      try {
        const ops = await listOperatorsForClient();
        setOperators(ops);
        // A equipe pré-definida do cliente já vem TODA selecionada (notifica todo
        // mundo no ClickUp); o cliente pode desmarcar quem não deve participar.
        setSelectedOps(new Set(ops.map((o) => String(o.id))));
      } catch (e) {
        setOpsError(errMessage(e));
        setOperators([]);
      }
    }
  }

  function toggleOp(id: string) {
    setSelectedOps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const t = title.trim();
    const operator_ids = [...selectedOps];
    if (!t) {
      setError('Informe um título.');
      return;
    }
    if (operator_ids.length === 0) {
      setError('Selecione pelo menos um operador.');
      return;
    }
    // Validação de datas (comparação por dia-calendário YYYY-MM-DD; inputs date já vêm nesse formato).
    const { todayStr, minEnds } = dateHints;
    if (startsAt && startsAt < todayStr) {
      setError('A data de início não pode estar no passado.');
      return;
    }
    if (endsAt && endsAt < minEnds) {
      setError(`O prazo final mínimo é ${fmtBR(minEnds)} (${MIN_LEAD_BD} dias úteis) — tempo mínimo para a equipe entregar com qualidade.`);
      return;
    }
    if (startsAt && endsAt && endsAt < startsAt) {
      setError('O prazo final deve ser igual ou posterior à data de início.');
      return;
    }
    setBusy(true);
    setBusyLabel('Criando…');
    let created: Demand;
    try {
      created = await createDemand({
        title: t,
        description: desc.trim() || null,
        operator_ids,
        project_id: mode === 'project' ? projectId : null,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
      });
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
      setBusy(false);
      return;
    }
    await uploadPickedFiles(created.id);
    toast('Demanda criada.', 'success');
    onCreated(created);
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Nova demanda" tabIndex={-1} ref={dialogRef}>
        <div className={styles.head}>
          <div>
            <h3>{step === 1 ? 'Nova demanda' : mode === 'project' ? '📁 Chamado de projeto' : '⚡ Chamado simples'}</h3>
            <div className={styles.stepLabel}>
              {step === 1 ? 'Passo 1 de 2 — Modo do chamado' : 'Passo 2 de 2 — Detalhes e equipe'}
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        {step === 1 ? (
          <div className={styles.body}>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.84rem' }}>
              Como você quer abrir esse chamado?
            </p>
            <div className={styles.modeGrid}>
              <button
                type="button"
                className={`${styles.modeCard} ${mode === 'simple' ? styles.selected : ''}`}
                onClick={() => {
                  setMode('simple');
                  setProjectId('');
                }}
              >
                <div className={styles.modeEmoji}>⚡</div>
                <div className={styles.modeTitle}>Chamado simples</div>
                <div className={styles.modeDesc}>Pedido avulso e rápido, sem projeto.</div>
              </button>
              <button
                type="button"
                className={`${styles.modeCard} ${mode === 'project' ? styles.selected : ''}`}
                onClick={() => setMode('project')}
              >
                <div className={styles.modeEmoji}>📁</div>
                <div className={styles.modeTitle}>Chamado de projeto</div>
                <div className={styles.modeDesc}>Vinculado a um evento — a equipe já vê o briefing.</div>
              </button>
            </div>

            {mode === 'project' && (
              <div style={{ marginTop: 16 }}>
                <label className={styles.label}>Projeto (evento)</label>
                <select
                  className={styles.select}
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={loadingProjects || !!projectsError}
                >
                  {loadingProjects ? (
                    <option value="">Carregando projetos…</option>
                  ) : projectsError ? (
                    <option value="">Erro ao carregar projetos</option>
                  ) : projects && projects.length > 0 ? (
                    <>
                      <option value="">— Selecione o projeto —</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title || 'Evento'}
                        </option>
                      ))}
                    </>
                  ) : (
                    <option value="">Nenhum projeto ativo — crie um em Projetos</option>
                  )}
                </select>
                {projectsError && (
                  <div className={styles.error} style={{ marginTop: 8 }}>
                    {projectsError}{' '}
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      style={{ padding: '2px 8px', marginLeft: 4 }}
                      onClick={() => {
                        setProjectsError(null);
                        setProjects(null);
                      }}
                    >
                      Tentar de novo
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>
                Cancelar
              </button>
              <button type="button" className={styles.btnPrimary} onClick={() => void goStep2()} disabled={!canNext}>
                Próximo →
              </button>
            </div>
          </div>
        ) : (
          <form className={`${styles.body} ${styles.form}`} onSubmit={submit}>
            <div>
              <label className={styles.label}>Título da demanda</label>
              <input
                className={styles.input}
                type="text"
                required
                placeholder="Ex: Campanha de captação — Seminário Jun/26"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className={styles.label}>
                Descrição <span className={styles.opt}>(opcional)</span>
              </label>
              <textarea
                className={styles.textarea}
                rows={3}
                placeholder="Contexto adicional, links, referências…"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </div>
            <div>
              <label className={styles.label}>
                Anexos <span className={styles.opt}>(opcional)</span>
              </label>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPT_ATTR}
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className={`${styles.dropzone} ${dragover ? styles.dragover : ''}`}
                onClick={() => fileRef.current?.click()}
                disabled={busy || files.length >= MAX_FILES}
                onDragEnter={(e) => {
                  if (Array.from(e.dataTransfer.types).includes('Files')) {
                    e.preventDefault();
                    setDragover(true);
                  }
                }}
                onDragOver={(e) => {
                  if (Array.from(e.dataTransfer.types).includes('Files')) {
                    e.preventDefault();
                    setDragover(true);
                  }
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragover(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragover(false);
                  if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
                }}
              >
                <IconClip />
                <span>
                  {files.length >= MAX_FILES
                    ? `Limite de ${MAX_FILES} anexos atingido`
                    : 'Anexar prints, PDFs ou documentos — clique ou arraste aqui'}
                </span>
              </button>
              {files.length > 0 && (
                <div className={styles.fileList}>
                  {files.map((f) => (
                    <div key={f.id} className={styles.fileRow}>
                      <span
                        className={styles.fileThumb}
                        style={f.thumbUrl ? { backgroundImage: `url('${f.thumbUrl}')` } : undefined}
                      >
                        {f.thumbUrl ? '' : <IconFile />}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className={styles.fileName} style={{ display: 'block' }}>
                          {f.file.name}
                        </span>
                        <span className={styles.fileSize}>{fmtSize(f.file.size)}</span>
                      </span>
                      <button
                        type="button"
                        className={styles.fileRemove}
                        title="Remover anexo"
                        aria-label={`Remover ${f.file.name}`}
                        disabled={busy}
                        onClick={() => removeFile(f.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <small className={styles.hint}>
                Até {MAX_FILES} arquivos de {fmtSize(CHAT_CONFIG.MAX_FILE_SIZE)}. Eles abrem a conversa da demanda e vão junto para a equipe.
              </small>
            </div>
            <div>
              <label className={styles.label}>Equipe responsável</label>
              <div className={styles.operators}>
                {operators === null ? (
                  <div
                    className="muted"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', padding: 10 }}
                  >
                    <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                    Carregando operadores…
                  </div>
                ) : opsError ? (
                  <div style={{ color: 'var(--danger)', fontSize: '0.84rem', padding: 8 }}>{opsError}</div>
                ) : operators.length === 0 ? (
                  <div className="muted" style={{ fontSize: '0.84rem', padding: 8 }}>
                    Sua equipe ainda não foi montada. Fale com o admin.
                  </div>
                ) : (
                  operators.map((o) => {
                    const id = String(o.id);
                    return (
                      <label key={id} className={styles.opRow}>
                        <input type="checkbox" checked={selectedOps.has(id)} onChange={() => toggleOp(id)} />
                        <span
                          className={styles.opAvatar}
                          style={
                            o.position_color
                              ? { background: `linear-gradient(135deg, ${o.position_color}33, ${o.position_color})` }
                              : undefined
                          }
                        >
                          {initials(o.name)}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span className={styles.opName} style={{ display: 'block' }}>
                            {o.name}
                          </span>
                          <span className={styles.opRole}>{o.position_name || 'Sem cargo'}</span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              <small className={styles.hint}>Sua equipe já vem selecionada e será avisada — desmarque quem não deve participar desta demanda.</small>
            </div>
            <div className={styles.grid2}>
              <div>
                <label className={styles.label}>Data de início</label>
                <input
                  className={styles.input}
                  type="date"
                  min={dateHints.todayStr}
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>
              <div>
                <label className={styles.label}>Prazo final</label>
                <input
                  className={styles.input}
                  type="date"
                  min={dateHints.minEnds}
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
                <small className={styles.hint}>
                  Sugerimos {SUGGESTED_LEAD_BD} dias úteis. Prazo mínimo: {fmtBR(dateHints.minEnds)}.
                </small>
              </div>
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.actions}>
              <button type="button" className={styles.btnSecondary} onClick={() => setStep(1)}>
                ← Voltar
              </button>
              <button type="submit" className={styles.btnPrimary} disabled={busy}>
                {busy ? busyLabel : 'Criar demanda'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
