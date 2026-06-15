'use client';

// Demandas do cliente — port de portal/demandas.html (tela mais complexa).
// Layout 3 colunas: lista | chat | detalhes. Realtime + composer com anexos.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  finalizeMyPart,
  getDemand,
  getDemandMembers,
  getMe,
  getMyDemandRating,
  isBaseReady,
  listMyDemands,
  type Demand,
  type DemandMember,
  type DemandStatus,
  type Me,
  type Rating,
} from '@/lib/api/demandas';
import { getMessage, hydrateAttachments, isImage, listMessages, postMessage, subscribe, type Attachment, type ChatMessage } from '@/lib/chat';
import { fmtDate, initials } from '@/lib/format';
import { toast } from '@/lib/toast';
import ChatComposer from '@/components/demandas/ChatComposer';
import NewDemandModal from '@/components/demandas/NewDemandModal';
import RatingModal from '@/components/demandas/RatingModal';
import styles from './page.module.css';

type Filter = 'all' | 'in_progress' | 'awaiting' | 'done';

const STATUS_LABEL: Record<string, string> = {
  open: 'Aberta',
  in_progress: 'Em andamento',
  review: 'Em revisão',
  done: 'Concluída',
  canceled: 'Cancelada',
};
const STATUS_TAG: Record<string, 'in_progress' | 'review' | 'done'> = {
  open: 'in_progress',
  in_progress: 'in_progress',
  review: 'review',
  done: 'done',
  canceled: 'done',
};

const PenIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);
const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const FileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

// ── Helpers de data/categoria (port das funções inline do legado) ──
function fmtTime(s?: string | null): string {
  if (!s) return '';
  return new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function fmtDayLabel(s?: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Hoje';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}
// Dias de diferença entre hoje e uma data de vencimento, comparando ambos como
// dia-calendário (YYYY-MM-DD em UTC) — evita erro de ±1 dia perto da meia-noite.
// Suporta `ends_at` como data pura ('YYYY-MM-DD') ou timestamp ISO.
function daysUntilDue(ends_at: string): number | null {
  const ymd = /^\d{4}-\d{2}-\d{2}/.exec(ends_at)?.[0];
  if (!ymd) return null;
  const [y, m, dd] = ymd.split('-').map(Number);
  const dueUTC = Date.UTC(y, m - 1, dd);
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dueUTC - todayUTC) / 86400000);
}
function dueLabel(d: Demand): string {
  if (d.status === 'done') return 'Concluída em ' + fmtDate(d.finalized_at);
  if (d.status === 'canceled') return 'Cancelada';
  if (!d.ends_at) return 'Sem prazo';
  const diff = daysUntilDue(d.ends_at);
  if (diff === null) return 'Sem prazo';
  if (diff < 0) return 'Atrasada — ' + fmtDate(d.ends_at);
  if (diff === 0) return 'Vence hoje';
  if (diff === 1) return 'Vence amanhã';
  return 'Vence em ' + diff + ' dias';
}
function categoryOf(members?: DemandMember[]): string {
  // members undefined ⇒ ainda não carregado (lazy): retorna vazio p/ não poluir a lista.
  if (!members) return '';
  const ops = members.filter((m) => m.role === 'operator');
  const positions = [...new Set(ops.map((m) => m.position_name).filter(Boolean))];
  if (positions.length === 0) return 'Sem categoria';
  if (positions.length === 1) return positions[0] as string;
  return positions.length + ' cargos';
}
function iconKeyFor(d: Demand): 'done' | 'review' | 'in_progress' {
  if (d.status === 'done') return 'done';
  if (d.status === 'review') return 'review';
  return 'in_progress';
}

export default function DemandasPage() {
  const [demands, setDemands] = useState<Demand[]>([]);
  const [members, setMembers] = useState<Record<string, DemandMember[]>>({});
  const [ratings, setRatings] = useState<Record<string, Rating | null>>({});
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [me, setMe] = useState<Me | null>(null);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [showNew, setShowNew] = useState(false);
  const [ratingFor, setRatingFor] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
  const [showDetail, setShowDetail] = useState(false); // sheet de detalhes no mobile

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentId;
  const messagesRef = useRef<Record<string, ChatMessage[]>>({});
  messagesRef.current = messages;

  // Caches LAZY (refs p/ não re-buscar nem re-subscrever): ids carregados + em voo.
  const membersLoaded = useRef<Set<string>>(new Set());
  const membersInflight = useRef<Set<string>>(new Set());
  const ratingsLoaded = useRef<Set<string>>(new Set());
  const ratingsInflight = useRef<Set<string>>(new Set());

  // ── Carga inicial (LEVE: só a lista; membros/rating carregam sob demanda) ──
  const loadAll = useCallback(async () => {
    try {
      const list = await listMyDemands();
      setDemands(list);
      setCurrentId((prev) => prev ?? (list.length > 0 ? list[0].id : null));
      return list;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }, []);

  // Carrega membros de UMA demanda (cache por id; força refetch após realtime/finalize).
  const ensureMembers = useCallback(async (demandId: string, force = false) => {
    if (!force && (membersInflight.current.has(demandId) || membersLoaded.current.has(demandId))) return;
    membersInflight.current.add(demandId);
    try {
      const mem = await getDemandMembers(demandId);
      membersLoaded.current.add(demandId);
      setMembers((prev) => ({ ...prev, [demandId]: mem }));
    } catch (e) {
      console.error('ensureMembers', e);
    } finally {
      membersInflight.current.delete(demandId);
    }
  }, []);

  // Carrega rating de UMA demanda concluída (cache por id).
  const ensureRating = useCallback(async (demandId: string) => {
    if (ratingsInflight.current.has(demandId) || ratingsLoaded.current.has(demandId)) return;
    ratingsInflight.current.add(demandId);
    try {
      const r = await getMyDemandRating(demandId);
      ratingsLoaded.current.add(demandId);
      setRatings((prev) => ({ ...prev, [demandId]: r }));
    } catch {
      setRatings((prev) => ({ ...prev, [demandId]: null }));
    } finally {
      ratingsInflight.current.delete(demandId);
    }
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [profile] = await Promise.all([getMe()]);
      if (cancel) return;
      setMe(profile);
      await loadAll();
      if (!cancel) setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [loadAll]);

  // ── Carrega mensagens (com hydrate de anexos) ──
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
      console.error(e);
    }
  }, []);

  // Append incremental de UMA mensagem nova (sem refetch/re-hidratar todas).
  const appendMessage = useCallback(async (demandId: string, messageId: string) => {
    try {
      const msg = await getMessage(messageId);
      if (!msg) return;
      setMessages((prev) => {
        const list = prev[demandId] || [];
        if (list.some((m) => m.id === msg.id)) return prev; // dedup (eco do próprio envio)
        return { ...prev, [demandId]: [...list, msg] };
      });
    } catch (e) {
      console.error('appendMessage', e);
    }
  }, []);

  // Rede de segurança contra eventos de realtime perdidos (blip de conexão / aba
  // em background): busca a lista e ANEXA só o que faltou (dedup por id).
  const syncMessages = useCallback(async (demandId: string) => {
    try {
      const fresh = await listMessages(demandId);
      const existingIds = new Set((messagesRef.current[demandId] || []).map((m) => m.id));
      const novos = fresh.filter((m) => !existingIds.has(m.id));
      if (!novos.length) return;
      for (const m of novos) {
        if (Array.isArray(m.attachments) && m.attachments.length) {
          m.attachments = await hydrateAttachments(m.attachments);
        }
      }
      setMessages((prev) => {
        const ex = prev[demandId] || [];
        const exIds = new Set(ex.map((x) => x.id));
        const add = novos.filter((m) => !exIds.has(m.id));
        return add.length ? { ...prev, [demandId]: [...ex, ...add] } : prev;
      });
    } catch (e) {
      console.error('syncMessages', e);
    }
  }, []);

  // ── Realtime para a demanda atual ──
  useEffect(() => {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    if (!currentId) return;
    void loadMessages(currentId);
    // Lazy: carrega membros só da demanda aberta (rating tem efeito próprio abaixo).
    void ensureMembers(currentId);
    unsubRef.current = subscribe(currentId, {
      onMessage: (raw) => {
        const id = currentIdRef.current;
        const msgId = raw?.id != null ? String(raw.id) : null;
        if (!id) return;
        if (msgId) void appendMessage(id, msgId);
        else void loadMessages(id); // fallback: payload sem id
      },
      onDemandUpdate: async (raw) => {
        const id = String(raw.id);
        const fresh = await getDemand(id);
        await ensureMembers(id, true);
        if (fresh) setDemands((prev) => prev.map((x) => (x.id === id ? fresh : x)));
      },
    });

    // Rede de segurança: poll leve + re-sync ao voltar o foco/visibilidade da aba.
    const poll = setInterval(() => void syncMessages(currentId), 7000);
    const onActive = () => {
      if (document.visibilityState === 'visible') void syncMessages(currentId);
    };
    document.addEventListener('visibilitychange', onActive);
    window.addEventListener('focus', onActive);

    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onActive);
      window.removeEventListener('focus', onActive);
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [currentId, loadMessages, appendMessage, ensureMembers, syncMessages]);

  // Lazy: carrega o rating da demanda aberta assim que ela estiver concluída.
  const currentStatus = currentId ? demands.find((d) => d.id === currentId)?.status : null;
  useEffect(() => {
    if (currentId && currentStatus === 'done') void ensureRating(currentId);
  }, [currentId, currentStatus, ensureRating]);

  // Auto-scroll do chat ao receber/atualizar mensagens.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, currentId]);

  // ── Derivados ──
  const counts = useMemo(
    () => ({
      all: demands.length,
      in_progress: demands.filter((d) => d.status === 'open' || d.status === 'in_progress' || d.status === 'review').length,
      awaiting: demands.filter((d) => d.status === 'review').length,
      done: demands.filter((d) => d.status === 'done').length,
    }),
    [demands],
  );

  const filtered = useMemo(() => {
    let items = demands;
    if (filter === 'in_progress') items = items.filter((d) => d.status === 'open' || d.status === 'in_progress' || d.status === 'review');
    else if (filter === 'awaiting') items = items.filter((d) => d.status === 'review');
    else if (filter === 'done') items = items.filter((d) => d.status === 'done');
    const q = search.trim().toLowerCase();
    if (q) items = items.filter((d) => (d.title || '').toLowerCase().includes(q));
    return items;
  }, [demands, filter, search]);

  const current = useMemo(() => demands.find((d) => d.id === currentId) || null, [demands, currentId]);
  const currentMsgs = currentId ? messages[currentId] || [] : [];
  const currentMembers = currentId ? members[currentId] || [] : [];
  const operators = currentMembers.filter((m) => m.role === 'operator');
  // Membros CLIENTES (não operadores). Operadores entram com user_id sintético
  // (operator_id) e user_role='operator' — não devem contar como cliente.
  const clientMembers = currentMembers.filter((m) => m.role !== 'operator' && m.user_role !== 'operator');

  // ── Nova demanda (gate-aware) ──
  async function openNewDemand() {
    try {
      if (!(await isBaseReady())) {
        toast('Conclua o Briefing Básico antes de abrir chamados.', 'warning');
        window.location.href = '/portal/briefing-basico';
        return;
      }
    } catch {
      /* falha de rede: segue */
    }
    setShowNew(true);
  }

  async function onDemandCreated(created: Demand) {
    setShowNew(false);
    const list = await loadAll();
    const found = list.find((d) => d.id === created.id);
    setCurrentId(created.id);
    if (!found) {
      // Garante presença mesmo se a view ainda não refletiu.
      setDemands((prev) => (prev.some((d) => d.id === created.id) ? prev : [created, ...prev]));
    }
    void loadMessages(created.id);
  }

  // ── Finalizar minha parte (apenas membro CLIENTE = o próprio logado) ──
  // Operadores NÃO aprovam por aqui (têm user_id sintético + user_role='operator').
  const isClientMember = !!me && clientMembers.some((m) => m.user_id === me.id);
  const alreadyApproved = !!me && clientMembers.some((m) => m.user_id === me.id && m.approved_finish);

  async function doFinalize() {
    if (!currentId || !current) return;
    if (!window.confirm('Confirmar que sua parte está concluída?\n\nA demanda só é fechada quando todos os operadores aprovarem.')) return;
    try {
      const res = await finalizeMyPart(currentId);
      await ensureMembers(currentId, true);
      const updated = await getDemand(currentId);
      if (updated) setDemands((prev) => prev.map((x) => (x.id === currentId ? updated : x)));
      if (res?.status === 'done') toast('Demanda concluída! Todos os operadores aprovaram.', 'success');
      else toast('Sua parte foi marcada como concluída.', 'success');
    } catch (e) {
      toast('Erro: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  }

  // ── Etapas (timeline) ──
  function renderSteps() {
    if (!current) return null;
    const opCount = operators.length; // só p/ "Equipe trabalhando"
    // Aprovação conta SOMENTE membros clientes — demand_operators não tem coluna
    // de aprovação (operadores não aprovam). Não entram no denominador.
    const approved = clientMembers.filter((m) => m.approved_finish).length;
    const total = clientMembers.length;
    return (
      <div className={styles.steps}>
        <div className={`${styles.step} ${styles.done}`}>
          <span className={styles.dot}>
            <Check />
          </span>
          <span>
            <span className={styles.stepTitle}>Demanda aberta</span>
            <span className={styles.stepWhen}>{fmtDate(current.created_at)}</span>
          </span>
        </div>
        <div className={`${styles.step} ${current.status === 'open' ? styles.current : styles.done}`}>
          <span className={styles.dot}>{current.status !== 'open' && <Check />}</span>
          <span>
            <span className={styles.stepTitle}>Equipe trabalhando</span>
            <span className={styles.stepWhen}>
              {opCount} operador{opCount === 1 ? '' : 'es'}
            </span>
          </span>
        </div>
        <div className={`${styles.step} ${current.status === 'done' ? styles.done : styles.current}`}>
          <span className={styles.dot}>{current.status === 'done' && <Check />}</span>
          <span>
            <span className={styles.stepTitle}>
              Aprovação {approved}/{total}
            </span>
            <span className={styles.stepWhen}>
              {total === 0 ? 'Aguardando equipe' : approved === total ? 'Todos aprovaram' : 'Aguardando todos confirmarem'}
            </span>
          </span>
        </div>
        {current.status === 'done' && (
          <div className={`${styles.step} ${styles.done}`}>
            <span className={styles.dot}>
              <Check />
            </span>
            <span>
              <span className={styles.stepTitle}>Concluída</span>
              <span className={styles.stepWhen}>{fmtDate(current.finalized_at)}</span>
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── Detalhes: prazo com cor ──
  function dueClass(): string {
    if (!current) return '';
    if (current.status === 'done') return styles.onTime;
    if (current.ends_at) {
      const diff = daysUntilDue(current.ends_at);
      if (diff !== null) {
        if (diff < 0) return styles.late;
        if (diff <= 3) return styles.dueSoon;
      }
    }
    return '';
  }

  // ── Render de anexos de mensagem ──
  function renderAttachments(atts: Attachment[]) {
    if (!Array.isArray(atts) || atts.length === 0) return null;
    return (
      <div className={styles.msgAtt}>
        {atts.map((a, i) => {
          if (!a) return null;
          const url = a.signedUrl || a.url || '';
          const name = a.name || 'arquivo';
          if (isImage(a.mime)) {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                className={styles.msgImg}
                src={url}
                alt={name}
                loading="lazy"
                onClick={() => setLightbox({ url, alt: name })}
              />
            );
          }
          return (
            <a key={i} className={styles.msgFile} href={url} target="_blank" rel="noopener noreferrer">
              <FileIcon />
              <span>{name}</span>
            </a>
          );
        })}
      </div>
    );
  }

  const rating = currentId ? ratings[currentId] : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.pageHead}>
        <div>
          <h1>Minhas demandas</h1>
          <p className="sub">Acompanhe e converse sobre suas demandas com sua equipe.</p>
        </div>
        <button type="button" className={styles.newBtn} onClick={() => void openNewDemand()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nova demanda
        </button>
      </div>

      <div className={styles.layout}>
        {/* ── LISTA ── */}
        <aside className={`${styles.pane} ${styles.listPane} ${currentId ? styles.hideMobile : ''}`}>
          <div className={styles.listHead}>
            <div className={styles.filterTabs}>
              <button className={filter === 'all' ? styles.active : ''} onClick={() => setFilter('all')}>
                Todas <span className={styles.cnt}>{counts.all}</span>
              </button>
              <button className={filter === 'in_progress' ? styles.active : ''} onClick={() => setFilter('in_progress')}>
                Em andamento <span className={styles.cnt}>{counts.in_progress}</span>
              </button>
              <button
                className={`${styles.urgent} ${filter === 'awaiting' ? styles.active : ''}`}
                onClick={() => setFilter('awaiting')}
              >
                Aguardando você <span className={styles.cnt}>{counts.awaiting}</span>
              </button>
              <button className={filter === 'done' ? styles.active : ''} onClick={() => setFilter('done')}>
                Concluídas <span className={styles.cnt}>{counts.done}</span>
              </button>
            </div>
            <div className={styles.searchWrap}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input type="text" placeholder="Buscar demanda…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className={styles.listScroll}>
            {loadError ? (
              <div className={styles.loadError}>Erro: {loadError}</div>
            ) : loading ? (
              <>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className={styles.skItem}>
                    <div className={`${styles.skBlock} ${styles.skIcon}`} />
                    <div>
                      <div className={`${styles.skBlock} ${styles.skLine}`} />
                      <div className={`${styles.skBlock} ${styles.skLineSm}`} />
                    </div>
                  </div>
                ))}
              </>
            ) : filtered.length === 0 ? (
              <div className={styles.empty}>Nenhuma demanda nessa categoria.</div>
            ) : (
              filtered.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`${styles.listItem} ${d.id === currentId ? styles.active : ''} ${d.status === 'review' ? styles.awaiting : ''}`}
                  onClick={() => setCurrentId(d.id)}
                >
                  <span className={`${styles.listIcon} ${styles[iconKeyFor(d)]}`}>
                    <PenIcon />
                  </span>
                  <span className={styles.listBody}>
                    <span className={styles.listTitle} style={{ display: 'block' }}>
                      {d.title || 'Sem título'}
                    </span>
                    <span className={styles.listMeta}>
                      {(() => {
                        const cat = categoryOf(members[d.id]);
                        return cat ? (
                          <>
                            <span>{cat}</span>
                            <span>•</span>
                          </>
                        ) : null;
                      })()}
                      <span>{dueLabel(d)}</span>
                    </span>
                  </span>
                  <span />
                </button>
              ))
            )}
          </div>
        </aside>

        {/* ── CHAT ── */}
        <section className={`${styles.pane} ${styles.chatPane} ${currentId ? '' : styles.hideMobile}`}>
          <div className={styles.chatHead}>
            <div className={styles.chatHeadMain}>
              <button
                type="button"
                className={styles.backBtn}
                onClick={() => {
                  setShowDetail(false);
                  setCurrentId(null);
                }}
                aria-label="Voltar para a lista"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <div style={{ minWidth: 0 }}>
                <h2>{current ? current.title || 'Sem título' : 'Selecione uma demanda'}</h2>
                {current && (
                  <div className={styles.chatMeta}>
                    <span className={`${styles.statusBadge} ${styles[STATUS_TAG[current.status]]}`}>
                      {STATUS_LABEL[current.status] || current.status}
                    </span>
                    <span>{current.starts_at ? `Início ${fmtDate(current.starts_at)}` : ''}</span>
                  </div>
                )}
              </div>
            </div>
            {current && (
              <button
                type="button"
                className={styles.detailsLink}
                onClick={() => {
                  if (typeof window !== 'undefined' && window.innerWidth <= 1180) setShowDetail(true);
                  else detailRef.current?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                Ver detalhes →
              </button>
            )}
          </div>

          <div className={styles.chatScroll} ref={chatScrollRef}>
            {!current ? (
              <div className={styles.chatEmpty}>
                Nada por aqui ainda.
                <br />
                <small>Clique em uma demanda na lista ao lado.</small>
              </div>
            ) : currentMsgs.length === 0 ? (
              <div className={styles.chatEmpty}>Comece a conversa com sua equipe — diga o que precisa pra essa demanda. 💬</div>
            ) : (
              (() => {
                let lastDay = '';
                const nodes: React.ReactNode[] = [];
                currentMsgs.forEach((m) => {
                  const day = fmtDayLabel(m.created_at);
                  if (day !== lastDay) {
                    nodes.push(
                      <div key={'day-' + m.id} className={styles.msgDay}>
                        {day}
                      </div>,
                    );
                    lastDay = day;
                  }
                  const mine = !!me && m.user_id === me.id;
                  const role = mine ? 'cliente' : m.author_role === 'operator' ? 'equipe' : m.author_role || 'equipe';
                  nodes.push(
                    <div key={m.id} className={`${styles.msg} ${mine ? styles.mine : ''}`}>
                      <span
                        className={styles.msgAvatar}
                        style={m.avatar_url ? { backgroundImage: `url('${m.avatar_url}')` } : undefined}
                      >
                        {m.avatar_url ? '' : initials(m.author_name)}
                      </span>
                      <span>
                        <span className={styles.msgAuthor}>
                          {m.author_name || 'Alguém'} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>•</span>{' '}
                          <span className="role">{role}</span>
                        </span>
                        {m.content && <span className={styles.msgBubble} style={{ display: 'block' }}>{m.content}</span>}
                        {renderAttachments(m.attachments)}
                        <span className={styles.msgTime} style={{ display: 'block', textAlign: mine ? 'right' : 'left' }}>
                          {fmtTime(m.created_at)}
                        </span>
                      </span>
                    </div>,
                  );
                });
                return nodes;
              })()
            )}
          </div>

          <ChatComposer
            demandId={currentId}
            disabled={!current}
            onSend={async ({ content, attachments }) => {
              if (!currentId || !me) return;
              const inserted = (await postMessage(currentId, content, attachments, me.id, me.client_slug || '')) as
                | { id?: string | number }
                | null;
              // Append incremental do próprio envio (dedup cobre o eco do realtime).
              if (inserted?.id != null) await appendMessage(currentId, String(inserted.id));
              else await loadMessages(currentId);
            }}
          />
        </section>

        {/* ── DETALHES ── */}
        {showDetail && <div className={styles.detailBackdrop} onClick={() => setShowDetail(false)} />}
        <aside className={`${styles.pane} ${styles.detailPane} ${showDetail ? styles.detailOpen : ''}`} ref={detailRef}>
          <button
            type="button"
            className={styles.detailClose}
            onClick={() => setShowDetail(false)}
            aria-label="Fechar detalhes"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          {!current ? (
            <div className={styles.detailSection}>
              <p className="muted" style={{ fontSize: '0.86rem' }}>
                Selecione uma demanda para ver os detalhes.
              </p>
            </div>
          ) : (
            <>
              <div className={styles.detailSection}>
                <h3>Sobre essa demanda</h3>
                <div className={styles.infoRow}>
                  <span className={styles.lbl}>Status</span>
                  <span className={styles.val}>
                    <span className={`${styles.statusBadge} ${styles[STATUS_TAG[current.status]]}`}>
                      {STATUS_LABEL[current.status]}
                    </span>
                  </span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.lbl}>Aberta em</span>
                  <span className={styles.val}>{fmtDate(current.created_at)}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.lbl}>Prazo</span>
                  <span className={`${styles.val} ${dueClass()}`}>{dueLabel(current)}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.lbl}>Categoria</span>
                  <span className={styles.val}>{categoryOf(currentMembers)}</span>
                </div>
              </div>

              <div className={styles.detailSection}>
                <h3>Etapas da entrega</h3>
                {renderSteps()}
              </div>

              {current.status === 'done' && rating && rating.status === 'pending' && (
                <div className={styles.detailSection}>
                  <div className={styles.ratingPending}>
                    <div className="t">Como foi essa entrega?</div>
                    <div className="s">Sua avaliação ajuda a equipe a crescer.</div>
                    <button type="button" className={styles.rateBtn} onClick={() => setRatingFor(current.id)}>
                      Avaliar agora
                    </button>
                  </div>
                </div>
              )}
              {current.status === 'done' && rating && rating.status === 'submitted' && (
                <div className={styles.detailSection}>
                  <div className={styles.ratingDone}>
                    <div className="t">
                      Você avaliou: {'★'.repeat(rating.score)}
                      <span style={{ opacity: 0.35 }}>{'★'.repeat(Math.max(0, 5 - rating.score))}</span> ({rating.score}/5)
                    </div>
                    {rating.comment && <div className="c">&ldquo;{rating.comment}&rdquo;</div>}
                  </div>
                </div>
              )}

              <div className={styles.detailSection}>
                <h3>
                  Pessoas envolvidas{' '}
                  <span className="small">
                    {operators.length} pessoa{operators.length === 1 ? '' : 's'}
                  </span>
                </h3>
                <div className={styles.teamMini}>
                  {operators.length === 0 ? (
                    <div className="muted" style={{ fontSize: '0.84rem' }}>
                      Sem operadores.
                    </div>
                  ) : (
                    operators.map((m) => (
                      <div key={String(m.id)} className={styles.teamItem}>
                        <span
                          className={styles.teamAvatar}
                          style={
                            m.position_color
                              ? { background: `linear-gradient(135deg, ${m.position_color}33, ${m.position_color})` }
                              : undefined
                          }
                        >
                          {initials(m.user_name)}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, display: 'block' }}>{m.user_name || '—'}</span>
                          <span className={styles.teamRole}>{m.position_name || '—'}</span>
                        </span>
                        {m.approved_finish && (
                          <span className={styles.approvedTick} title="Aprovou finalização">
                            ✓
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {isClientMember && current.status !== 'done' && current.status !== 'canceled' && (
                <div className={styles.detailSection}>
                  <button type="button" className={styles.finalizeBtn} onClick={() => void doFinalize()} disabled={alreadyApproved}>
                    {alreadyApproved ? 'Você já aprovou. Aguardando outros…' : 'Finalizar minha parte'}
                  </button>
                  <small className={styles.finalizeHint}>A demanda é concluída quando todos aprovam.</small>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {showNew && <NewDemandModal onClose={() => setShowNew(false)} onCreated={(d) => void onDemandCreated(d)} />}
      {ratingFor && current && (
        <RatingModal
          demandId={ratingFor}
          demandTitle={current.title || 'Demanda'}
          onClose={() => setRatingFor(null)}
          onSubmitted={async () => {
            const r = await getMyDemandRating(ratingFor);
            ratingsLoaded.current.add(ratingFor);
            setRatings((prev) => ({ ...prev, [ratingFor]: r }));
            setRatingFor(null);
          }}
        />
      )}

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.url} alt={lightbox.alt} />
          <button type="button" className={styles.lightboxClose} title="Fechar" onClick={() => setLightbox(null)}>
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
