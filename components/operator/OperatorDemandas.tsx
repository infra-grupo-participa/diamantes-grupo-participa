'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  getMe,
  listAssignedDemands,
  updateDemandStatus,
  getMyOperatorRating,
  type AssignedDemand,
  type DemandStatus,
  type OperatorProfile,
  type OperatorRating,
} from '@/lib/api/operator';
import {
  listMessages,
  postMessage,
  subscribe,
  hydrateAttachments,
  isImage,
  type ChatMessage,
  type Attachment,
} from '@/lib/chat';
import { initials } from '@/lib/format';
import { toast } from '@/lib/toast';
import {
  DemandIcon,
  inferIconClass,
  STATUS_LABEL,
  STATUS_TAG,
  dueMeta,
} from '@/components/operator/demand-meta';
import ChatComposer from '@/components/operator/ChatComposer';
import OperatorRatingModal from '@/components/operator/OperatorRatingModal';
import s from './demandas.module.css';

const STATUS_TABS: (DemandStatus | 'all')[] = ['all', 'open', 'in_progress', 'review', 'done'];
const STATUS_TAB_LABEL: Record<string, string> = {
  all: 'Todas',
  open: 'Novas',
  in_progress: 'Em andamento',
  review: 'Em revisão',
  done: 'Concluídas',
};

const TAG_CLASS: Record<string, string> = {
  new: s.tagNew,
  in_progress: s.tagIn_progress,
  review: s.tagReview,
  done: s.tagDone,
};

function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function fmtRelative(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return Math.floor(diff / 60) + ' min';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function fmtDateLong(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ICON_FILE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

function StatusTag({ status }: { status: string }) {
  const tag = STATUS_TAG[status] || 'new';
  return <span className={`${s.demandTag} ${TAG_CLASS[tag] || s.tagNew}`}>{STATUS_LABEL[status] || status}</span>;
}

function statusActions(status: DemandStatus): { to: DemandStatus; label: string }[] {
  if (status === 'open') return [{ to: 'in_progress', label: 'Começar trabalho' }];
  if (status === 'in_progress') return [{ to: 'review', label: 'Marcar para revisão' }];
  if (status === 'review') return [{ to: 'in_progress', label: 'Voltar para em andamento' }];
  return [];
}

export default function OperatorDemandas() {
  const searchParams = useSearchParams();
  const initialId = searchParams.get('d');

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<OperatorProfile | null>(null);
  const [demands, setDemands] = useState<AssignedDemand[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [filter, setFilter] = useState<DemandStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [ratings, setRatings] = useState<Record<string, OperatorRating | null>>({});
  const [busyStatus, setBusyStatus] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);

  const unsubRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentId;

  const current = useMemo(() => demands.find((d) => d.id === currentId) || null, [demands, currentId]);

  const reloadDemands = useCallback(async () => {
    const data = await listAssignedDemands({ status: 'all' });
    setDemands(data);
    return data;
  }, []);

  const loadMessages = useCallback(async (demandId: string) => {
    try {
      const msgs = await listMessages(demandId);
      for (const m of msgs) {
        if (Array.isArray(m.attachments) && m.attachments.length) {
          m.attachments = await hydrateAttachments(m.attachments);
        }
      }
      setMessages((prev) => ({ ...prev, [demandId]: msgs }));
    } catch (e) {
      console.error('loadMessages', e);
    }
  }, []);

  const loadRating = useCallback(async (d: AssignedDemand | null) => {
    if (!d || d.status !== 'done') {
      if (d) setRatings((prev) => ({ ...prev, [d.id]: null }));
      return;
    }
    try {
      const r = await getMyOperatorRating(d.id);
      setRatings((prev) => ({ ...prev, [d.id]: r }));
    } catch (e) {
      console.error('loadRating', e);
      setRatings((prev) => ({ ...prev, [d.id]: null }));
    }
  }, []);

  // Inscrição realtime na demanda corrente
  useEffect(() => {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    if (!currentId) return;
    unsubRef.current = subscribe(currentId, {
      onMessage: async () => {
        await loadMessages(currentId);
      },
      onDemandUpdate: async () => {
        const data = await reloadDemands();
        const d = data.find((x) => x.id === currentIdRef.current) || null;
        await loadRating(d);
      },
    });
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [currentId, loadMessages, reloadDemands, loadRating]);

  // Auto-scroll do chat
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, currentId]);

  const selectDemand = useCallback(
    async (id: string) => {
      setCurrentId((prev) => (prev === id ? prev : id));
      const d = demands.find((x) => x.id === id) || null;
      await Promise.all([loadMessages(id), loadRating(d)]);
    },
    [demands, loadMessages, loadRating],
  );

  // Bootstrap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meRow = await getMe().catch(() => null);
      const data = await listAssignedDemands({ status: 'all' }).catch((e) => {
        console.error(e);
        return [] as AssignedDemand[];
      });
      if (cancelled) return;
      setMe(meRow);
      setDemands(data);
      setLoading(false);
      const startId = initialId && data.some((d) => d.id === initialId) ? initialId : data[0]?.id;
      if (startId) {
        setCurrentId(startId);
        const d = data.find((x) => x.id === startId) || null;
        await Promise.all([loadMessages(startId), loadRating(d)]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    return demands.reduce<Record<string, number>>(
      (acc, d) => {
        acc.all = (acc.all || 0) + 1;
        acc[d.status] = (acc[d.status] || 0) + 1;
        return acc;
      },
      { all: 0 },
    );
  }, [demands]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return demands.filter((d) => {
      if (filter !== 'all' && d.status !== filter) return false;
      if (q) {
        const hay = ((d.title || '') + ' ' + (d.client_display_name || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [demands, filter, search]);

  async function changeStatus(to: DemandStatus) {
    if (!current) return;
    setBusyStatus(true);
    try {
      await updateDemandStatus(current.id, to);
      const data = await reloadDemands();
      const d = data.find((x) => x.id === current.id) || null;
      await loadRating(d);
    } catch (e) {
      toast('Falha ao mudar status: ' + ((e as Error).message || e), 'error');
    } finally {
      setBusyStatus(false);
    }
  }

  async function handleSend({ content, attachments }: { content: string; attachments: Attachment[] }) {
    if (!currentId || !me) return;
    await postMessage(currentId, content, attachments, me.id, current?.client_slug || undefined);
    await loadMessages(currentId);
  }

  function renderAttachments(att: Attachment[] | null) {
    if (!Array.isArray(att) || att.length === 0) return null;
    return (
      <div className={s.att}>
        {att.map((a, i) => {
          if (!a) return null;
          const url = a.signedUrl || a.url || '';
          if (isImage(a.mime)) {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                className={s.attImg}
                src={url}
                alt={a.name || 'anexo'}
                loading="lazy"
                onClick={() => setLightbox({ url, alt: a.name || '' })}
              />
            );
          }
          return (
            <a key={i} className={s.attFile} href={url} target="_blank" rel="noopener noreferrer">
              {ICON_FILE}
              <span>{a.name || 'arquivo'}</span>
            </a>
          );
        })}
      </div>
    );
  }

  if (loading) {
    return (
      <div className={s.wrap}>
        <div className={s.pageHead}>
          <div>
            <div className={`${s.sk} ${s.skLine}`} style={{ width: 200, height: 26 }} />
            <div className={`${s.sk} ${s.skLine}`} style={{ width: 320, marginTop: 8 }} />
          </div>
        </div>
        <div className={s.statusTabs}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${s.sk} ${s.skLine}`} style={{ width: 96, height: 38, borderRadius: 12 }} />
          ))}
        </div>
        <div className={s.workArea}>
          <section className={s.listCard}>
            <div className={s.skList}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={s.skRow}>
                  <div className={`${s.sk} ${s.skIcon}`} />
                  <div>
                    <div className={`${s.sk} ${s.skLine}`} style={{ width: '60%' }} />
                    <div className={`${s.sk} ${s.skLine}`} style={{ width: '40%', marginTop: 6, height: 10 }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  const msgs = (currentId && messages[currentId]) || [];
  const currentRating = current ? ratings[current.id] : null;
  const actions = current ? statusActions(current.status) : [];

  return (
    <div className={s.wrap}>
      <div className={s.pageHead}>
        <div>
          <h1>Minhas demandas</h1>
          <p className={s.sub}>Demandas atribuídas a você. Selecione uma para conversar com o aluno.</p>
        </div>
        <div className={s.searchBox}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            placeholder="Buscar por aluno ou título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className={s.statusTabs}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            className={`${s.statusTab} ${filter === tab ? s.active : ''}`}
            onClick={() => setFilter(tab)}
          >
            {STATUS_TAB_LABEL[tab]}
            <span className={s.count}>{counts[tab] || 0}</span>
          </button>
        ))}
      </div>

      <div className={`${s.workArea} ${currentId ? s.detailOpen : ''}`}>
        <section className={s.listCard}>
          {filtered.length === 0 ? (
            <div className={s.listEmpty}>
              {demands.length === 0
                ? 'Nenhuma demanda atribuída a você ainda.'
                : 'Nenhuma demanda corresponde aos filtros.'}
            </div>
          ) : (
            filtered.map((d) => {
              const cls = inferIconClass(d.title);
              const lastAt = d.last_message_at || d.updated_at || d.created_at;
              return (
                <button
                  key={d.id}
                  className={`${s.listRow} ${d.id === currentId ? s.active : ''}`}
                  onClick={() => selectDemand(d.id)}
                >
                  <div className={`${s.demandIcon} ${s[cls]}`}>
                    <DemandIcon cls={cls} />
                  </div>
                  <div className={s.rowInfo}>
                    <div className={s.rowTitle}>{d.title || 'Sem título'}</div>
                    <div className={s.rowMeta}>
                      {d.client_display_name || '—'}
                      <span className={s.sep}>•</span> {dueMeta(d)}
                    </div>
                  </div>
                  <StatusTag status={d.status} />
                  <span className={s.rowDate}>{fmtRelative(lastAt)}</span>
                </button>
              );
            })
          )}
        </section>

        <aside className={s.detailCard}>
          <div className={s.detailHead}>
            {current ? (
              <>
                <button className={s.backBtn} onClick={() => setCurrentId(null)} title="Voltar para a lista">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  Voltar
                </button>
                <div className={`${s.demandIcon} ${s[inferIconClass(current.title)]}`}>
                  <DemandIcon cls={inferIconClass(current.title)} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3>{current.title}</h3>
                  <div className={s.who}>
                    {current.client_display_name || '—'} • {dueMeta(current)}
                  </div>
                </div>
              </>
            ) : (
              <div className={s.detailPlaceholder}>Selecione uma demanda à esquerda.</div>
            )}
          </div>

          {current && (
            <div className={s.detailBody}>
              <div className={s.infoGrid}>
                <div className={s.infoItem}>
                  <div className={s.k}>Status</div>
                  <div className={s.v}>{STATUS_LABEL[current.status] || current.status}</div>
                </div>
                <div className={s.infoItem}>
                  <div className={s.k}>Aberta em</div>
                  <div className={s.v}>{fmtDateLong(current.created_at)}</div>
                </div>
                <div className={s.infoItem}>
                  <div className={s.k}>Prazo</div>
                  <div className={s.v}>{current.ends_at ? fmtDateLong(current.ends_at) : '—'}</div>
                </div>
                <div className={s.infoItem}>
                  <div className={s.k}>Mensagens</div>
                  <div className={s.v}>{current.message_count || 0}</div>
                </div>
              </div>

              {current.description && <div className={s.descBox}>{current.description}</div>}

              {current.status === 'done' && currentRating && (
                <div className={s.ratingBanner}>
                  {currentRating.status === 'pending' ? (
                    <div className={s.ratePending}>
                      <div className={s.pendT}>Como foi atender esse aluno?</div>
                      <div className={s.pendD}>Sua avaliação ajuda a triagem futura de demandas.</div>
                      <button className={s.opBtn} style={{ fontSize: '0.8rem' }} onClick={() => setShowRatingModal(true)}>
                        Avaliar cliente
                      </button>
                    </div>
                  ) : currentRating.status === 'submitted' ? (
                    <div className={s.rateDone}>
                      <div className={s.doneT}>Você avaliou o cliente com {currentRating.score}/5 ⭐</div>
                      {currentRating.comment && <div className={s.doneC}>&quot;{currentRating.comment}&quot;</div>}
                      {currentRating.dimensions && Object.keys(currentRating.dimensions).length > 0 && (
                        <div className={s.dims}>
                          {Object.entries(currentRating.dimensions)
                            .map(([k, v]) => `${k}: ${v}/5`)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {actions.length > 0 && (
                <div className={s.statusActions}>
                  {actions.map((a) => (
                    <button key={a.to} className={s.opBtn} disabled={busyStatus} onClick={() => changeStatus(a.to)}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={s.chatScroll} ref={scrollRef}>
            {!current ? null : msgs.length === 0 ? (
              <div className={s.chatEmpty}>Nenhuma mensagem ainda. Diga oi pro aluno 👋</div>
            ) : (
              msgs.map((m) => {
                const mine = !!(me && m.user_id === me.id);
                return (
                  <div className={`${s.msg} ${mine ? s.msgMine : ''}`} key={m.id}>
                    <div
                      className={s.av}
                      style={{ background: `linear-gradient(135deg,#fde68a,${mine ? 'var(--accent)' : '#f59e0b'})` }}
                    >
                      {initials(m.author_name)}
                    </div>
                    <div className={s.msgBody}>
                      <div className={s.msgHead}>
                        <span className={s.name}>{mine ? 'Você' : m.author_name || 'Alguém'}</span>
                        <span>{fmtTime(m.created_at)}</span>
                      </div>
                      {m.content && <div className={s.msgText}>{m.content}</div>}
                      {renderAttachments(m.attachments)}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <ChatComposer demandId={currentId} onSend={handleSend} />
        </aside>
      </div>

      {showRatingModal && current && (
        <OperatorRatingModal
          demandId={current.id}
          clientName={current.client_display_name || ''}
          demandTitle={current.title || ''}
          onClose={() => setShowRatingModal(false)}
          onDone={async () => {
            await loadRating(current);
          }}
        />
      )}

      {lightbox && (
        <div className={s.lightbox} onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.url} alt={lightbox.alt} />
          <button className={s.lightboxClose} title="Fechar" onClick={() => setLightbox(null)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
