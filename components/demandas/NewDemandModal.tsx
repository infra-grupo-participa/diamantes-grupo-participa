'use client';

// Modal Nova Demanda — wizard 3 passos: Tipo → Vínculo (simples × projeto) → Detalhes.
// Port de buildNewDemandModal()/ndGoStep2()/ndForm de portal/demandas.html.
// Gate-aware: o caller só abre se isBaseReady().
// Tipo 'editor-video' troca a descrição livre pelo briefing obrigatório e o prazo
// passa a ter hora (p_due_at, sugerido — o editor remarca no ClickUp).

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  CreateDemandError,
  createDemand,
  listMyContractedTypes,
  listMyProjects,
  listOperatorsForClient,
  type ContractedType,
  type Demand,
  type Operator,
  type Project,
} from '@/lib/api/demandas';
import {
  OTHER_SERVICE_TYPE,
  VIDEO_FIELD_ORDER,
  VIDEO_SERVICE_TYPE,
  buildVideoBriefing,
  emptyVideoBriefing,
  isDueError,
  parseBriefingErrorKeys,
  spDateTimeToIso,
  validateVideoBriefing,
  type VideoBriefingDraft,
  type VideoBriefingErrors,
} from '@/lib/video-briefing';
import VideoBriefingForm, { videoFieldId } from './VideoBriefingForm';
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
const DEFAULT_DUE_TIME = '18:00'; // hora pré-preenchida do prazo com hora (editor-video)

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

/** Foca por id depois do próximo paint (o campo pode ter acabado de aparecer). */
function focusLater(id: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'center' });
    }
  });
}

export default function NewDemandModal({
  onClose,
  onCreated,
  userId,
  clientSlug,
}: {
  onClose: () => void;
  onCreated: (demand: Demand) => void;
  /** portal.users.id do cliente logado — necessário para postar os anexos no chat. */
  userId: number | null;
  /** portal.users.client_slug do logado. Opcional: sem ele o modal resolve via getMe (1 SELECT a mais). */
  clientSlug?: string | null;
}) {
  const uid = useId();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [serviceType, setServiceType] = useState<string | null>(null);
  const [types, setTypes] = useState<ContractedType[] | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [typesReload, setTypesReload] = useState(0);
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
  const [dueTime, setDueTime] = useState(DEFAULT_DUE_TIME);
  const [video, setVideo] = useState<VideoBriefingDraft>(emptyVideoBriefing);
  const [videoErrors, setVideoErrors] = useState<VideoBriefingErrors>({});
  const [dueError, setDueError] = useState<string | null>(null);
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

  // Tipos contratados: 1 RPC por abertura do modal (o modal não desmonta entre passos).
  useEffect(() => {
    let cancel = false;
    setTypesError(null);
    listMyContractedTypes(clientSlug)
      .then((rows) => {
        if (!cancel) setTypes(rows);
      })
      .catch((e) => {
        if (cancel) return;
        // Falha não trava: "Outro" continua disponível.
        setTypesError(errMessage(e));
        setTypes([]);
      });
    return () => {
      cancel = true;
    };
  }, [clientSlug, typesReload]);

  // Ao trocar de passo, foco no primeiro controle do passo (teclado/leitor de tela).
  const firstStepRender = useRef(true);
  useEffect(() => {
    if (firstStepRender.current) {
      firstStepRender.current = false;
      return;
    }
    const target =
      step === 1
        ? `${uid}-type-${Math.max(0, typeIndexRef.current)}`
        : step === 2
          ? `${uid}-mode-${modeRef.current ?? 'simple'}`
          : `${uid}-title`;
    focusLater(target);
  }, [step, uid]);

  const isVideo = serviceType === VIDEO_SERVICE_TYPE;
  const typeOptions = useMemo(() => {
    const list = (types ?? [])
      .filter((t) => t.position_slug !== OTHER_SERVICE_TYPE)
      .map((t) => ({ value: t.position_slug, label: t.position_name || t.position_slug }));
    list.push({ value: OTHER_SERVICE_TYPE, label: 'Outro' });
    return list;
  }, [types]);
  const typeLabel = typeOptions.find((o) => o.value === serviceType)?.label ?? '';
  // Refs para o efeito de foco devolver o cliente à opção que ele já tinha escolhido.
  const typeIndexRef = useRef(-1);
  typeIndexRef.current = typeOptions.findIndex((o) => o.value === serviceType);
  const modeRef = useRef<Mode | null>(null);
  modeRef.current = mode;

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

  async function goStep3() {
    if (!canNext) return;
    setStep(3);
    // Sugestão de prazo: pré-preenche o prazo final se o cliente ainda não escolheu.
    if (!endsAt) setEndsAt(dateHints.suggestedEnds);
    if (operators === null) {
      try {
        const ops = await listOperatorsForClient(clientSlug);
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

  const ids = {
    title: `${uid}-title`,
    desc: `${uid}-desc`,
    op0: `${uid}-op-0`,
    starts: `${uid}-starts`,
    ends: `${uid}-ends`,
    dueTime: `${uid}-due-time`,
    dueNote: `${uid}-due-note`,
    dueErr: `${uid}-due-err`,
  };

  /** Mostra o erro geral e leva o foco ao campo culpado. */
  function fail(msg: string, fieldId?: string) {
    setError(msg);
    if (fieldId) focusLater(fieldId);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDueError(null);
    setVideoErrors({});
    const t = title.trim();
    const operator_ids = [...selectedOps];
    if (!t) {
      fail('Informe um título.', ids.title);
      return;
    }
    if (isVideo) {
      const vErr = validateVideoBriefing(video);
      const first = VIDEO_FIELD_ORDER.find((k) => vErr[k]);
      if (first) {
        setVideoErrors(vErr);
        fail('Revise os campos destacados do briefing.', videoFieldId(uid, first));
        return;
      }
    }
    if (operator_ids.length === 0) {
      fail('Selecione pelo menos um operador.', operators && operators.length ? ids.op0 : undefined);
      return;
    }
    // Validação de datas (comparação por dia-calendário YYYY-MM-DD; inputs date já vêm nesse formato).
    const { todayStr, minEnds } = dateHints;
    if (startsAt && startsAt < todayStr) {
      fail('A data de início não pode estar no passado.', ids.starts);
      return;
    }
    if (isVideo && !endsAt) {
      setDueError('Informe a data do prazo sugerido.');
      fail('Informe a data do prazo sugerido.', ids.ends);
      return;
    }
    if (isVideo && !/^\d{2}:\d{2}$/.test(dueTime)) {
      setDueError('Informe a hora do prazo sugerido.');
      fail('Informe a hora do prazo sugerido.', ids.dueTime);
      return;
    }
    if (endsAt && endsAt < minEnds) {
      const msg = `O prazo final mínimo é ${fmtBR(minEnds)} (${MIN_LEAD_BD} dias úteis) — tempo mínimo para a equipe entregar com qualidade.`;
      if (isVideo) setDueError(msg);
      fail(msg, ids.ends);
      return;
    }
    if (startsAt && endsAt && endsAt < startsAt) {
      fail('O prazo final deve ser igual ou posterior à data de início.', ids.ends);
      return;
    }
    setBusy(true);
    setBusyLabel('Criando…');
    let created: Demand;
    try {
      created = await createDemand({
        title: t,
        description: isVideo ? null : desc.trim() || null,
        operator_ids,
        project_id: mode === 'project' ? projectId : null,
        starts_at: startsAt || null,
        // editor-video: o prazo vai com hora em due_at; o banco deriva ends_at.
        ends_at: isVideo ? null : endsAt || null,
        service_type: serviceType,
        briefing: isVideo ? buildVideoBriefing(video) : null,
        due_at: isVideo ? spDateTimeToIso(endsAt, dueTime) : null,
      });
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : String(ex);
      setBusy(false);
      // Mapeia o erro do servidor para o campo (briefing → chaves; prazo → data).
      const keys = isVideo && ex instanceof CreateDemandError ? parseBriefingErrorKeys(msg) : [];
      if (keys.length) {
        const vErr: VideoBriefingErrors = {};
        keys.forEach((k) => (vErr[k] = 'Obrigatório ou inválido — confira este campo.'));
        setVideoErrors(vErr);
        fail('O servidor recusou o briefing: revise os campos destacados.', videoFieldId(uid, keys[0]));
        return;
      }
      if (ex instanceof CreateDemandError && isDueError(msg)) {
        setDueError(msg);
        fail(msg, ids.ends);
        return;
      }
      fail(msg);
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
            <h3>{step < 3 ? 'Nova demanda' : mode === 'project' ? '📁 Chamado de projeto' : '⚡ Chamado simples'}</h3>
            <div className={styles.stepLabel}>
              {step === 1
                ? 'Passo 1 de 3 — Tipo da demanda'
                : step === 2
                  ? `Passo 2 de 3 — Modo do chamado · ${typeLabel}`
                  : `Passo 3 de 3 — Detalhes e equipe · ${typeLabel}`}
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        {step === 1 ? (
          <div className={styles.body}>
            {types === null ? (
              <div
                className="muted"
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', padding: 10 }}
              >
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                Carregando tipos de serviço…
              </div>
            ) : (
              <fieldset className={styles.fieldset}>
                <legend className={styles.label}>Que tipo de serviço você precisa?</legend>
                <div className={styles.typeList}>
                  {typeOptions.map((o, i) => (
                    <label key={o.value} className={styles.typeItem}>
                      <input
                        id={`${uid}-type-${i}`}
                        type="radio"
                        name={`${uid}-type`}
                        value={o.value}
                        checked={serviceType === o.value}
                        onChange={() => setServiceType(o.value)}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
                {typesError ? (
                  <div className={styles.error} style={{ marginTop: 8 }}>
                    Não foi possível carregar seus serviços contratados ({typesError}).{' '}
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      style={{ padding: '2px 8px', marginLeft: 4 }}
                      onClick={() => {
                        setTypes(null);
                        setTypesReload((n) => n + 1);
                      }}
                    >
                      Tentar de novo
                    </button>
                  </div>
                ) : types.length === 0 ? (
                  <small className={styles.hint}>
                    Nenhum serviço contratado ativo encontrado — use &quot;Outro&quot; e descreva o pedido.
                  </small>
                ) : null}
              </fieldset>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>
                Cancelar
              </button>
              <button type="button" className={styles.btnPrimary} onClick={() => setStep(2)} disabled={!serviceType}>
                Próximo →
              </button>
            </div>
          </div>
        ) : step === 2 ? (
          <div className={styles.body}>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.84rem' }}>
              Como você quer abrir esse chamado?
            </p>
            <div className={styles.modeGrid}>
              <button
                id={`${uid}-mode-simple`}
                type="button"
                aria-pressed={mode === 'simple'}
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
                aria-pressed={mode === 'project'}
                className={`${styles.modeCard} ${mode === 'project' ? styles.selected : ''}`}
                id={`${uid}-mode-project`}
                onClick={() => setMode('project')}
              >
                <div className={styles.modeEmoji}>📁</div>
                <div className={styles.modeTitle}>Chamado de projeto</div>
                <div className={styles.modeDesc}>Vinculado a um evento — a equipe já vê o briefing.</div>
              </button>
            </div>

            {mode === 'project' && (
              <div style={{ marginTop: 16 }}>
                <label className={styles.label} htmlFor={`${uid}-project`}>
                  Projeto (evento)
                </label>
                <select
                  id={`${uid}-project`}
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
              <button type="button" className={styles.btnSecondary} onClick={() => setStep(1)}>
                ← Voltar
              </button>
              <button type="button" className={styles.btnPrimary} onClick={() => void goStep3()} disabled={!canNext}>
                Próximo →
              </button>
            </div>
          </div>
        ) : (
          // noValidate: a validação é nossa (erro no campo + foco no 1º inválido);
          // a nativa do navegador brigaria com type="url" e com o briefing.
          <form className={`${styles.body} ${styles.form}`} onSubmit={submit} noValidate>
            <div>
              <label className={styles.label} htmlFor={ids.title}>
                Título da demanda
              </label>
              <input
                id={ids.title}
                className={styles.input}
                type="text"
                required
                placeholder="Ex: Campanha de captação — Seminário Jun/26"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            {isVideo ? (
              <VideoBriefingForm
                idPrefix={uid}
                value={video}
                errors={videoErrors}
                disabled={busy}
                onChange={(patch) => {
                  setVideo((prev) => ({ ...prev, ...patch }));
                  // Some com o erro do campo assim que o cliente mexe nele.
                  const touched = Object.keys(patch) as Array<keyof VideoBriefingErrors>;
                  if (touched.some((k) => videoErrors[k])) {
                    setVideoErrors((prev) => {
                      const next = { ...prev };
                      touched.forEach((k) => delete next[k]);
                      return next;
                    });
                  }
                }}
              />
            ) : (
              <div>
                <label className={styles.label} htmlFor={ids.desc}>
                  Descrição <span className={styles.opt}>(opcional)</span>
                </label>
                <textarea
                  id={ids.desc}
                  className={styles.textarea}
                  rows={3}
                  placeholder="Contexto adicional, links, referências…"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </div>
            )}
            <div>
              <div className={styles.label}>
                Anexos <span className={styles.opt}>(opcional)</span>
              </div>
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
            <fieldset className={styles.fieldset}>
              <legend className={styles.label}>Equipe responsável</legend>
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
                  operators.map((o, i) => {
                    const id = String(o.id);
                    return (
                      <label key={id} className={styles.opRow}>
                        <input
                          id={i === 0 ? ids.op0 : undefined}
                          type="checkbox"
                          checked={selectedOps.has(id)}
                          onChange={() => toggleOp(id)}
                        />
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
            </fieldset>
            {isVideo ? (
              <div>
                <div className={styles.grid2}>
                  <div>
                    <label className={styles.label} htmlFor={ids.ends}>
                      Prazo sugerido — data
                    </label>
                    <input
                      id={ids.ends}
                      className={styles.input}
                      type="date"
                      required
                      min={dateHints.minEnds}
                      value={endsAt}
                      aria-invalid={dueError ? true : undefined}
                      aria-describedby={`${ids.dueNote}${dueError ? ` ${ids.dueErr}` : ''}`}
                      onChange={(e) => {
                        setEndsAt(e.target.value);
                        setDueError(null);
                      }}
                    />
                  </div>
                  <div>
                    <label className={styles.label} htmlFor={ids.dueTime}>
                      Hora (Brasília)
                    </label>
                    <input
                      id={ids.dueTime}
                      className={styles.input}
                      type="time"
                      required
                      step={300}
                      value={dueTime}
                      aria-describedby={ids.dueNote}
                      onChange={(e) => {
                        setDueTime(e.target.value);
                        setDueError(null);
                      }}
                    />
                  </div>
                </div>
                {dueError && (
                  <div id={ids.dueErr} className={styles.fieldError}>
                    {dueError}
                  </div>
                )}
                <div id={ids.dueNote} className={styles.dueNote}>
                  <strong>Prazo sugerido</strong> — o editor pode remarcar conforme a agenda e você será avisado.
                  Mínimo: {fmtBR(dateHints.minEnds)} ({MIN_LEAD_BD} dias úteis).
                </div>
                <div style={{ marginTop: 14 }}>
                  <label className={styles.label} htmlFor={ids.starts}>
                    Data de início <span className={styles.opt}>(opcional)</span>
                  </label>
                  <input
                    id={ids.starts}
                    className={styles.input}
                    type="date"
                    min={dateHints.todayStr}
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                </div>
              </div>
            ) : (
            <div className={styles.grid2}>
              <div>
                <label className={styles.label} htmlFor={ids.starts}>
                  Data de início
                </label>
                <input
                  id={ids.starts}
                  className={styles.input}
                  type="date"
                  min={dateHints.todayStr}
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>
              <div>
                <label className={styles.label} htmlFor={ids.ends}>
                  Prazo final
                </label>
                <input
                  id={ids.ends}
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
            )}
            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.btnSecondary} onClick={() => setStep(2)}>
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
