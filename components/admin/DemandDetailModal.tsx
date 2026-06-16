'use client';

import { useEffect, useState, useCallback } from 'react';
import { initials, fmtDate, fmtDateTime } from '@/lib/format';
import { toast } from '@/lib/toast';
import {
  getDemandFullDetails,
  adminUpdateDemandStatus,
  getDemandOperators,
  listActiveOperators,
  addDemandOperator,
  removeDemandOperator,
  STATUS_BADGE,
  clickupTaskUrl,
  type DemandStatus,
  type Demand,
  type DemandMemberFull,
  type DemandMessage,
  type DemandOperator,
} from '@/lib/api/admin-demandas';
import { errMessage } from '@/lib/errors';
import styles from '@/app/admin/demandas/demandas.module.css';

const STATUSES: DemandStatus[] = ['open', 'in_progress', 'review', 'done', 'canceled'];

const ClickUpIcon = ({ size = 10 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ width: size, height: size }}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

type Details = { demand: Demand; members: DemandMemberFull[]; messages: DemandMessage[] };

export default function DemandDetailModal({
  demandId,
  onClose,
  onChanged,
}: {
  demandId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [det, setDet] = useState<Details | null>(null);
  const [busy, setBusy] = useState(false);
  const [ops, setOps] = useState<DemandOperator[]>([]);
  const [allOps, setAllOps] = useState<DemandOperator[]>([]);
  const [opBusy, setOpBusy] = useState(false);
  const [selOp, setSelOp] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, dops, active] = await Promise.all([
        getDemandFullDetails(demandId),
        getDemandOperators(demandId),
        listActiveOperators(),
      ]);
      if (!d) {
        onClose();
        return;
      }
      setDet(d);
      setOps(dops);
      setAllOps(active);
    } catch (e) {
      toast('Erro: ' + errMessage(e), 'error');
      onClose();
    }
  }, [demandId, onClose]);

  async function addOp() {
    if (!selOp || opBusy) return;
    setOpBusy(true);
    try {
      await addDemandOperator(demandId, selOp);
      setSelOp('');
      setOps(await getDemandOperators(demandId));
      toast('Operador adicionado. O ClickUp será sincronizado.', 'success');
      onChanged();
    } catch (e) {
      toast(errMessage(e), 'error');
    } finally {
      setOpBusy(false);
    }
  }

  async function removeOp(operatorId: string, name: string | null) {
    if (opBusy) return;
    if (!window.confirm(`Remover ${name || 'este operador'} da demanda?`)) return;
    setOpBusy(true);
    try {
      await removeDemandOperator(demandId, operatorId);
      setOps(await getDemandOperators(demandId));
      toast('Operador removido.', 'success');
      onChanged();
    } catch (e) {
      toast(errMessage(e), 'error');
    } finally {
      setOpBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function changeStatus(ns: DemandStatus) {
    if (!det) return;
    if (!window.confirm(`Mudar status para "${STATUS_BADGE[ns].label}"?`)) return;
    setBusy(true);
    try {
      await adminUpdateDemandStatus(det.demand.id, ns);
      toast('Status atualizado.');
      onChanged();
      await load();
    } catch (e) {
      toast('Erro: ' + ((e as Error).message || e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const d = det?.demand;
  const sb = d ? STATUS_BADGE[d.status] ?? { cls: 'bCancel', label: d.status } : null;

  return (
    <div
      className={styles.modalBg}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <div>
            <h3>{d?.title || 'Sem título'}</h3>
            <div className={styles.modalSub}>
              {d ? (
                <>
                  {d.client_name || '—'} • aberta em {fmtDate(d.created_at)} •{' '}
                  {d.clickup_task_id ? (
                    <a href={clickupTaskUrl(d.clickup_task_id)} target="_blank" rel="noopener noreferrer">
                      Abrir no ClickUp ↗
                    </a>
                  ) : (
                    <span style={{ color: 'var(--d-muted)', fontSize: '0.78rem' }}>
                      sem vínculo ClickUp ainda
                    </span>
                  )}
                </>
              ) : (
                'Carregando…'
              )}
            </div>
          </div>
          <button className={styles.modalClose} onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          {!det || !d || !sb ? (
            <div className={styles.chatEmpty}>Carregando detalhes…</div>
          ) : (
            <>
              {/* Status */}
              <div>
                <h4 className={styles.sectionTitle}>Status</h4>
                <div>
                  <span className={`${styles.badge} ${styles[sb.cls]}`}>{sb.label}</span>
                </div>
                <div className={styles.statusActions}>
                  {STATUSES.map((s) => {
                    const isCurrent = d.status === s;
                    const cls = [
                      styles.statusBtn,
                      isCurrent ? styles.statusActive : '',
                      s === 'canceled' ? styles.statusDanger : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <button
                        key={s}
                        className={cls}
                        disabled={isCurrent || busy}
                        onClick={() => changeStatus(s)}
                      >
                        {STATUS_BADGE[s].label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Detalhes */}
              <div>
                <h4 className={styles.sectionTitle}>Detalhes</h4>
                <div className={styles.metaGrid}>
                  <div className={styles.metaItem}>
                    <div className={styles.metaLbl}>Cliente</div>
                    <div className={styles.metaVal}>{d.client_name || '—'}</div>
                  </div>
                  <div className={styles.metaItem}>
                    <div className={styles.metaLbl}>Solicitante</div>
                    <div className={styles.metaVal}>{d.created_by_name || '—'}</div>
                  </div>
                  <div className={styles.metaItem}>
                    <div className={styles.metaLbl}>Início</div>
                    <div className={styles.metaVal}>{fmtDate(d.starts_at)}</div>
                  </div>
                  <div className={styles.metaItem}>
                    <div className={styles.metaLbl}>Prazo</div>
                    <div className={styles.metaVal}>{fmtDate(d.ends_at)}</div>
                  </div>
                  <div className={styles.metaItem}>
                    <div className={styles.metaLbl}>Aberta em</div>
                    <div className={styles.metaVal}>{fmtDateTime(d.created_at)}</div>
                  </div>
                </div>
                {d.description && d.description.trim() && (
                  <div className={styles.descWrap}>{d.description}</div>
                )}
              </div>

              {/* Equipe */}
              <div>
                <h4 className={styles.sectionTitle}>Equipe</h4>
                <div className={styles.teamList}>
                  {det.members.length === 0 ? (
                    <div className={styles.teamEmpty}>Sem membros.</div>
                  ) : (
                    det.members.map((m, i) => {
                      const isOp = m.role === 'operator';
                      const avatarStyle = m.position_color
                        ? {
                            background: `linear-gradient(135deg,${m.position_color}33,${m.position_color})`,
                          }
                        : undefined;
                      return (
                        <div key={`${m.user_id}-${i}`} className={styles.teamRow}>
                          <div className={styles.avatar} style={avatarStyle}>
                            {initials(m.user_name)}
                          </div>
                          <div>
                            <div className={styles.teamName}>
                              {m.user_name || '—'}{' '}
                              <span className={styles.teamRoleTag}>
                                — {isOp ? 'operador' : 'cliente'}
                              </span>
                            </div>
                            <div className={styles.teamRole}>
                              {m.position_name || m.user_email || ''}
                            </div>
                          </div>
                          {isOp && (
                            <div className={styles.teamRight}>
                              {m.clickup_user_id ? (
                                <span
                                  className={styles.cuBadge}
                                  title={`Vinculado ao ClickUp (ID ${m.clickup_user_id})`}
                                >
                                  <ClickUpIcon />
                                  ClickUp
                                </span>
                              ) : (
                                <span className={styles.cuNone} title="Sem usuário no ClickUp">
                                  sem ClickUp
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Operadores responsáveis (reais — demand_operators) */}
              <div>
                <h4 className={styles.sectionTitle}>Operadores responsáveis</h4>
                <div className={styles.teamList}>
                  {ops.length === 0 ? (
                    <div className={styles.teamEmpty}>Nenhum operador atribuído ainda.</div>
                  ) : (
                    ops.map((o) => (
                      <div key={o.operator_id} className={styles.teamRow}>
                        <div
                          className={styles.avatar}
                          style={o.position_color ? { background: `linear-gradient(135deg,${o.position_color}33,${o.position_color})` } : undefined}
                        >
                          {initials(o.name)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className={styles.teamName}>{o.name || '—'}</div>
                          <div className={styles.teamRole}>{o.position_name || o.email || ''}</div>
                        </div>
                        <div className={styles.teamRight}>
                          {o.clickup_user_id ? (
                            <span className={styles.cuBadge} title={`Vinculado ao ClickUp (ID ${o.clickup_user_id})`}>
                              <ClickUpIcon />
                              ClickUp
                            </span>
                          ) : (
                            <span className={styles.cuNone} title="Sem usuário no ClickUp — não recebe notificação">
                              sem ClickUp
                            </span>
                          )}
                          <button
                            type="button"
                            className={styles.opRemove}
                            disabled={opBusy}
                            onClick={() => void removeOp(o.operator_id, o.name)}
                            title="Remover da demanda"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className={styles.opAddRow}>
                  <select className={styles.opSelect} value={selOp} onChange={(e) => setSelOp(e.target.value)} disabled={opBusy}>
                    <option value="">Adicionar operador…</option>
                    {allOps
                      .filter((a) => !ops.some((o) => o.operator_id === a.operator_id))
                      .map((a) => (
                        <option key={a.operator_id} value={a.operator_id}>
                          {a.name}
                          {a.position_name ? ` — ${a.position_name}` : ''}
                          {a.clickup_user_id ? '' : ' (sem ClickUp)'}
                        </option>
                      ))}
                  </select>
                  <button type="button" className={styles.opAddBtn} disabled={!selOp || opBusy} onClick={() => void addOp()}>
                    Adicionar
                  </button>
                </div>
                <small className={styles.opHint}>Operadores recebem a demanda como responsáveis no ClickUp (notificação).</small>
              </div>

              {/* Chat (read-only) */}
              <div>
                <h4 className={styles.sectionTitle}>Chat (somente leitura)</h4>
                <div className={styles.chatBox}>
                  {det.messages.length === 0 ? (
                    <div className={styles.chatEmpty}>Sem mensagens ainda.</div>
                  ) : (
                    det.messages.map((m) => (
                      <div key={m.id} className={styles.msg}>
                        <div
                          className={styles.avatar}
                          style={
                            m.avatar_url
                              ? { backgroundImage: `url('${m.avatar_url}')` }
                              : undefined
                          }
                        >
                          {m.avatar_url ? '' : initials(m.author_name)}
                        </div>
                        <div className={styles.msgBody}>
                          <div className={styles.msgAuthor}>{m.author_name || 'Alguém'}</div>
                          <div className={styles.msgText}>{m.content || ''}</div>
                          <div className={styles.msgTime}>{fmtDateTime(m.created_at)}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
