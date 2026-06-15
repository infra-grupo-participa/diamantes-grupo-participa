'use client';

// Modal Nova Demanda — wizard 2 steps (simples × projeto).
// Port de buildNewDemandModal()/ndGoStep2()/ndForm de portal/demandas.html.
// Gate-aware: o caller só abre se isBaseReady().

import { useEffect, useRef, useState } from 'react';
import {
  createDemand,
  listMyProjects,
  listOperatorsForClient,
  type Demand,
  type Operator,
  type Project,
} from '@/lib/api/demandas';
import { initials } from '@/lib/format';
import { toast } from '@/lib/toast';
import styles from './Modal.module.css';

type Mode = 'simple' | 'project';

export default function NewDemandModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (demand: Demand) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<Mode | null>(null);
  const [projectId, setProjectId] = useState<string>('');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [operators, setOperators] = useState<Operator[] | null>(null);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [selectedOps, setSelectedOps] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // a11y: fecha no Esc e foca o modal ao abrir.
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    if (operators === null) {
      try {
        const ops = await listOperatorsForClient();
        setOperators(ops);
        // A equipe pré-definida do cliente já vem TODA selecionada (notifica todo
        // mundo no ClickUp); o cliente pode desmarcar quem não deve participar.
        setSelectedOps(new Set(ops.map((o) => String(o.id))));
      } catch (e) {
        setOpsError(e instanceof Error ? e.message : String(e));
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
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (startsAt && startsAt < todayStr) {
      setError('A data de início não pode estar no passado.');
      return;
    }
    if (endsAt && endsAt < todayStr) {
      setError('O prazo final não pode estar no passado.');
      return;
    }
    if (startsAt && endsAt && endsAt < startsAt) {
      setError('O prazo final deve ser igual ou posterior à data de início.');
      return;
    }
    setBusy(true);
    try {
      const created = await createDemand({
        title: t,
        description: desc.trim() || null,
        operator_ids,
        project_id: mode === 'project' ? projectId : null,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
      });
      toast('Demanda criada.', 'success');
      onCreated(created);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
      setBusy(false);
    }
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
              <small className={styles.hint}>Sua equipe já vem selecionada e será notificada no ClickUp — desmarque quem não deve participar desta demanda.</small>
            </div>
            <div className={styles.grid2}>
              <div>
                <label className={styles.label}>Data de início</label>
                <input className={styles.input} type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div>
                <label className={styles.label}>Prazo final</label>
                <input className={styles.input} type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </div>
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.actions}>
              <button type="button" className={styles.btnSecondary} onClick={() => setStep(1)}>
                ← Voltar
              </button>
              <button type="submit" className={styles.btnPrimary} disabled={busy}>
                {busy ? 'Criando…' : 'Criar demanda'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
