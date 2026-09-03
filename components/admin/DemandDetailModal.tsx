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
  resolveAssigneeDivergence,
  STATUS_BADGE,
  ASSIGNEE_SYNC_BADGE,
  hasSyncBadge,
  CLICKUP_DELIVERY_LABEL,
  clickupTaskUrl,
  type DemandStatus,
  type Demand,
  type DemandMemberFull,
  type DemandMessage,
  type DemandOperator,
  type AssigneeDivergenceAction,
  type MissingAssignee,
  type ClickupDeliveryState,
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
  const [allOps, setAllOps] = useState<Array<DemandOperator & { clickup_notifiable: boolean | null }>>([]);
  const [opBusy, setOpBusy] = useState(false);
  const [selOp, setSelOp] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [confirmAccept, setConfirmAccept] = useState(false);

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

  /** 'reapply' e 'dismiss' não reescrevem demand_operators — seguem direto.
   *  'accept_clickup' é destrutivo: passa pelo modal de confirmação nominal
   *  (ver `renderAcceptConfirm`), nunca dispara daqui direto. */
  async function runDivergenceAction(action: AssigneeDivergenceAction) {
    if (syncBusy) return;
    setSyncBusy(true);
    try {
      await resolveAssigneeDivergence(demandId, action);
      toast(
        action === 'reapply'
          ? 'Reaplicado no ClickUp.'
          : action === 'accept_clickup'
            ? 'Responsáveis atualizados a partir do ClickUp.'
            : 'Divergência marcada como revisada.',
        'success',
      );
      onChanged();
      await load();
    } catch (e) {
      toast(errMessage(e), 'error');
    } finally {
      setSyncBusy(false);
      setConfirmAccept(false);
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
  const syncState = d?.clickup_assignee_sync ?? null;
  const syncBadge = syncState ? ASSIGNEE_SYNC_BADGE[syncState] : null;
  const syncMissing: MissingAssignee[] = Array.isArray(
    (d?.clickup_assignee_detail as { missing?: unknown } | null)?.missing,
  )
    ? ((d!.clickup_assignee_detail as { missing: MissingAssignee[] }).missing ?? [])
    : [];
  const syncAfter: Array<{ id: string; name?: string | null }> = Array.isArray(
    (d?.clickup_assignee_detail as { after?: unknown } | null)?.after,
  )
    ? ((d!.clickup_assignee_detail as { after: Array<{ id: string; name?: string | null }> }).after ?? [])
    : [];

  // Diff nominal para o modal de confirmação de accept_clickup: quem SAI
  // (está em demand_operators hoje e não tem clickup_user_id no snapshot do
  // ClickUp) e quem ENTRA (aparece no snapshot mas ainda não é operador aqui).
  const afterIds = new Set(syncAfter.map((a) => String(a.id)));
  const currentIds = new Set(ops.map((o) => String(o.clickup_user_id ?? '')));
  const diffOut = ops.filter((o) => !o.clickup_user_id || !afterIds.has(String(o.clickup_user_id)));
  const diffIn = syncAfter.filter((a) => !currentIds.has(String(a.id)));

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
                {syncBadge && hasSyncBadge(syncState) && (
                  <div style={{ marginBottom: 10 }}>
                    <span className={`${styles.syncBadge} ${styles[syncBadge.cls]}`}>
                      <span className={styles.syncIcon} aria-hidden="true">{syncBadge.icon}</span>
                      {syncBadge.label}
                    </span>
                  </div>
                )}
                <div className={styles.teamList}>
                  {ops.length === 0 ? (
                    <div className={styles.teamEmpty}>Nenhum operador atribuído ainda.</div>
                  ) : (
                    ops.map((o) => {
                      // Casa por clickup_user_id quando os dois lados têm; sem ID em algum
                      // lado (operador nunca teve ClickUp cadastrado), casa por nome — é o
                      // caso que a 087 passou a deixar aparecer de verdade em missing[].
                      const missingReason = syncMissing.find((m) =>
                        m.clickup_user_id != null && o.clickup_user_id
                          ? String(m.clickup_user_id) === String(o.clickup_user_id)
                          : m.clickup_user_id == null && !o.clickup_user_id && m.name === o.name,
                      );
                      // Estado de entrega em português: prioriza demand_operators.clickup_delivery
                      // (contrato do backend); sem operador no ClickUp, fica explícito; com
                      // divergência conhecida (missing[]) e delivery ainda 'unknown', deriva do
                      // motivo para não mostrar "desconhecido" quando já se sabe o porquê.
                      const knownDelivery = o.clickup_delivery ?? 'unknown';
                      const delivery: ClickupDeliveryState = !o.clickup_user_id
                        ? 'no_clickup_user'
                        : knownDelivery !== 'unknown'
                          ? knownDelivery
                          : missingReason?.reason === 'guest_cannot_assign'
                            ? 'blocked_guest'
                            : missingReason?.reason === 'no_clickup_user'
                              ? 'no_clickup_user'
                              : missingReason
                                ? 'blocked_other'
                                : 'unknown';
                      const deliveryInfo = CLICKUP_DELIVERY_LABEL[delivery];
                      return (
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
                            <span
                              className={`${styles.deliveryTag} ${styles[deliveryInfo.cls]}`}
                              title={o.clickup_user_id ? `ClickUp ID ${o.clickup_user_id}` : 'Sem usuário no ClickUp'}
                            >
                              {deliveryInfo.label}
                            </span>
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
                      );
                    })
                  )}
                </div>
                <div className={styles.opAddRow}>
                  <select
                    className={styles.opSelect}
                    value={selOp}
                    onChange={(e) => setSelOp(e.target.value)}
                    disabled={opBusy}
                    aria-label="Adicionar operador à demanda"
                  >
                    <option value="">Adicionar operador…</option>
                    {allOps
                      .filter((a) => !ops.some((o) => o.operator_id === a.operator_id))
                      .map((a) => (
                        <option key={a.operator_id} value={a.operator_id}>
                          {a.name}
                          {a.position_name ? ` — ${a.position_name}` : ''}
                          {!a.clickup_user_id
                            ? ' (sem ClickUp)'
                            : a.clickup_notifiable === false
                              ? ' (não recebe no ClickUp — guest)'
                              : ''}
                        </option>
                      ))}
                  </select>
                  <button type="button" className={styles.opAddBtn} disabled={!selOp || opBusy} onClick={() => void addOp()}>
                    Adicionar
                  </button>
                </div>
                <small className={styles.opHint}>Operadores recebem a demanda como responsáveis no ClickUp (notificação).</small>

                {hasSyncBadge(syncState) && syncState !== 'partial_expected' && (
                  <>
                    <div className={styles.syncActions}>
                      <button
                        type="button"
                        className={styles.syncActionBtn}
                        disabled={syncBusy}
                        onClick={() => void runDivergenceAction('reapply')}
                      >
                        Reaplicar no ClickUp
                      </button>
                      <button
                        type="button"
                        className={styles.syncActionBtn}
                        disabled={syncBusy}
                        onClick={() => setConfirmAccept(true)}
                      >
                        Aceitar estado do ClickUp
                      </button>
                      <button
                        type="button"
                        className={`${styles.syncActionBtn} ${styles.syncActionDanger}`}
                        disabled={syncBusy}
                        onClick={() => void runDivergenceAction('dismiss')}
                      >
                        Dispensar
                      </button>
                    </div>
                    <small className={styles.syncNote}>
                      &quot;Aceitar estado do ClickUp&quot; reescreve os responsáveis desta demanda a partir do que
                      está realmente atribuído lá — confirmação nominal antes de aplicar.
                    </small>
                  </>
                )}
                {syncState === 'partial_expected' && (
                  <small className={styles.syncNote}>
                    Estado esperado: operador é convidado (guest) no ClickUp e não pode ser responsável lá. Decisão
                    vigente é manter guest — não é necessário agir.
                  </small>
                )}
              </div>

              {confirmAccept && (
                <div
                  className={styles.modalBg}
                  style={{ zIndex: 1100 }}
                  onClick={(e) => {
                    if (e.target === e.currentTarget && !syncBusy) setConfirmAccept(false);
                  }}
                >
                  <div className={styles.modal} style={{ maxWidth: 480 }}>
                    <div className={styles.modalHead}>
                      <h3>Aceitar estado do ClickUp?</h3>
                      <button
                        className={styles.modalClose}
                        onClick={() => !syncBusy && setConfirmAccept(false)}
                        aria-label="Fechar"
                      >
                        ×
                      </button>
                    </div>
                    <div className={styles.modalBody}>
                      <p>
                        Isto reescreve os responsáveis do portal a partir do que está atribuído hoje no ClickUp para
                        esta demanda:
                      </p>
                      <div className={styles.confirmDiffGrid}>
                        <div className={`${styles.confirmDiffCol} ${styles.diffOut}`}>
                          <h5>Sai</h5>
                          {diffOut.length === 0 ? (
                            <div className={styles.confirmDiffEmpty}>Ninguém sai.</div>
                          ) : (
                            <ul>
                              {diffOut.map((o) => (
                                <li key={o.operator_id}>{o.name || o.operator_id}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className={`${styles.confirmDiffCol} ${styles.diffIn}`}>
                          <h5>Entra</h5>
                          {diffIn.length === 0 ? (
                            <div className={styles.confirmDiffEmpty}>Ninguém entra.</div>
                          ) : (
                            <ul>
                              {diffIn.map((a) => (
                                <li key={String(a.id)}>{a.name || `ClickUp #${a.id}`}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                      <div className={styles.confirmActions}>
                        <button
                          type="button"
                          className={styles.syncActionBtn}
                          disabled={syncBusy}
                          onClick={() => setConfirmAccept(false)}
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          className={`${styles.syncActionBtn} ${styles.syncActionDanger}`}
                          disabled={syncBusy}
                          onClick={() => void runDivergenceAction('accept_clickup')}
                        >
                          Confirmar e reescrever
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

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
