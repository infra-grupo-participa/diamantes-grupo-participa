'use client';

// Demandas do cliente — port de portal/demandas.html (tela mais complexa).
// Layout 3 colunas: lista | chat | detalhes. Realtime + composer com anexos.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clientCompleteDemand,
  clientRequestChanges,
  getDemand,
  getDemandMembers,
  getMe,
  isBaseReady,
  listMyDemands,
  markDemandRead,
  type Demand,
  type DemandMember,
  type DemandStatus,
  type Me,
} from '@/lib/api/demandas';
import { getMessage, hydrateAttachments, isImage, listMessages, postMessage, subscribe, type Attachment, type ChatMessage } from '@/lib/chat';
import { fmtDate, initials } from '@/lib/format';
import { toast } from '@/lib/toast';
import { errMessage } from '@/lib/errors';
import { listMyProjects, type Project } from '@/lib/api/projects';
import { getClientBriefing } from '@/lib/api/briefing';
import { BRIEFING_SERVICE_LABELS, type BriefingAnswers, type ProjectBriefing } from '@/lib/briefing-templates';
import {
  buildGeneralSection,
  buildProjectSections,
  buildAccessSections,
  type BriefingViewSection,
} from '@/components/briefing/BriefingReadView';
import Link from 'next/link';
import ChatComposer from '@/components/demandas/ChatComposer';
import NewDemandModal from '@/components/demandas/NewDemandModal';
import styles from './page.module.css';

// Normaliza o briefing de um projeto para o shape { general, services } —
// projetos legados podem divergir (campo ausente / formato antigo).
function normalizeProjectBriefing(b: ProjectBriefing | null | undefined): {
  general: BriefingAnswers;
  services: Record<string, BriefingAnswers>;
} {
  const obj = (b && typeof b === 'object' ? b : {}) as ProjectBriefing;
  const general = (obj.general && typeof obj.general === 'object' ? obj.general : {}) as BriefingAnswers;
  const services = (obj.services && typeof obj.services === 'object' ? obj.services : {}) as Record<string, BriefingAnswers>;
  return { general, services };
}

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

// Chave da "pasta" de demandas sem projeto (avulsas).
const AVULSAS_KEY = '__avulsas__';

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
// Urgência do prazo p/ colorir na lista: vermelho (atrasada) / âmbar (vence hoje/amanhã).
function dueUrgency(d: Demand): 'late' | 'soon' | '' {
  if (d.status === 'done' || d.status === 'canceled' || !d.ends_at) return '';
  const diff = daysUntilDue(d.ends_at);
  if (diff === null) return '';
  if (diff < 0) return 'late';
  if (diff <= 1) return 'soon';
  return '';
}
const DEMAND_READ_KEY = 'diamantes.demandRead';
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
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [me, setMe] = useState<Me | null>(null);
  // Briefing (F1): projetos do cliente indexados por id (1 query em lote) +
  // Briefing Básico (acessos) do cliente logado (1 fetch cacheado por sessão).
  const [projectsById, setProjectsById] = useState<Record<string, Project>>({});
  const [basicAccess, setBasicAccess] = useState<Record<string, BriefingAnswers>>({});
  // Filtro por projeto (via ?projeto=<id>, vindo do card de Projetos).
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      setProjectFilter(params.get('projeto'));
      // Deep-link da Início: ?d=<id> abre a demanda direto.
      const d = params.get('d');
      if (d) setCurrentId(d);
    } catch { /* */ }
  }, []);
  function clearProjectFilter() {
    setProjectFilter(null);
    try { window.history.replaceState(null, '', '/portal/demandas'); } catch { /* */ }
  }

  // Não-lidas: timestamp da última vez que o cliente viu cada demanda (localStorage).
  const [readMap, setReadMap] = useState<Record<string, string>>({});
  const markRead = useCallback((id: string, ts?: string | null) => {
    setReadMap((prev) => {
      const next = { ...prev, [id]: ts || new Date().toISOString() };
      try { localStorage.setItem(DEMAND_READ_KEY, JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }, []);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [showNew, setShowNew] = useState(false);
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

  // ── Carga inicial (LEVE: só a lista; membros/rating carregam sob demanda) ──
  const loadAll = useCallback(async () => {
    try {
      const list = await listMyDemands();
      setDemands(list);
      setCurrentId((prev) => {
        if (prev && list.some((d) => d.id === prev)) return prev; // ?d válido ou seleção atual
        return list.length > 0 ? list[0].id : null;
      });
      return list;
    } catch (e) {
      setLoadError(errMessage(e));
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

  useEffect(() => {
    let cancel = false;
    try { setReadMap(JSON.parse(localStorage.getItem(DEMAND_READ_KEY) || '{}')); } catch { /* */ }
    (async () => {
      const [profile] = await Promise.all([getMe()]);
      if (cancel) return;
      setMe(profile);
      await loadAll();
      if (!cancel) setLoading(false);
      // Briefing (F1): carga LAZY/best-effort, 2 fetches cacheados por sessão.
      // Não bloqueia a lista de demandas nem o chat.
      void (async () => {
        try {
          const [projs, brief] = await Promise.all([
            listMyProjects().catch(() => [] as Project[]),
            getClientBriefing().then((b) => b.access).catch(() => ({} as Record<string, BriefingAnswers>)),
          ]);
          if (cancel) return;
          setProjectsById(Object.fromEntries(projs.map((p) => [p.id, p])));
          setBasicAccess(brief);
        } catch {
          /* best-effort: a seção de briefing simplesmente não aparece */
        }
      })();
    })();
    return () => {
      cancel = true;
    };
  }, [loadAll]);

  // Marca a demanda ABERTA como lida (com o timestamp da última mensagem conhecida).
  useEffect(() => {
    if (!currentId) return;
    const d = demands.find((x) => x.id === currentId);
    markRead(currentId, (d?.last_message_at as string) || new Date().toISOString());
    // Registra a leitura NO SERVIDOR (otimização: e-mail de chat só quando ausente).
    void markDemandRead(currentId);
  }, [currentId, demands, markRead]);

  // Atualiza a lista (não-lidas + ordem por atividade) ao voltar o foco/visibilidade.
  useEffect(() => {
    const onActive = () => { if (document.visibilityState === 'visible') void loadAll(); };
    window.addEventListener('focus', onActive);
    document.addEventListener('visibilitychange', onActive);
    return () => {
      window.removeEventListener('focus', onActive);
      document.removeEventListener('visibilitychange', onActive);
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


  // Auto-scroll do chat ao receber/atualizar mensagens.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, currentId]);

  // ── Derivados ──
  // Não-lida = última mensagem é da EQUIPE e mais nova que a última vez que o cliente viu.
  const isUnread = useCallback(
    (d: Demand) =>
      d.id !== currentId &&
      d.last_message_from === 'team' &&
      !!d.last_message_at &&
      (!readMap[d.id] || (d.last_message_at as string) > readMap[d.id]),
    [currentId, readMap],
  );
  // "Precisam de você" = mensagem nova não-lida OU aguardando sua aprovação (review).
  const needsYou = useCallback((d: Demand) => isUnread(d) || d.status === 'review', [isUnread]);

  const counts = useMemo(
    () => ({
      all: demands.length,
      in_progress: demands.filter((d) => d.status === 'open' || d.status === 'in_progress' || d.status === 'review').length,
      awaiting: demands.filter((d) => needsYou(d)).length,
      done: demands.filter((d) => d.status === 'done').length,
    }),
    [demands, needsYou],
  );

  // Pastas (por projeto) recolhidas — chave do grupo no Set.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let items = demands;
    if (projectFilter) items = items.filter((d) => d.project_id === projectFilter);
    if (filter === 'in_progress') items = items.filter((d) => d.status === 'open' || d.status === 'in_progress' || d.status === 'review');
    else if (filter === 'awaiting') items = items.filter((d) => needsYou(d));
    else if (filter === 'done') items = items.filter((d) => d.status === 'done');
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter((d) =>
        `${d.title || ''} ${d.description || ''} ${d.project_title || ''}`.toLowerCase().includes(q),
      );
    }
    return items;
  }, [demands, filter, search, projectFilter, needsYou]);

  // Agrupa as demandas filtradas em "pastas" por projeto (avulsas por último).
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; title: string; items: Demand[] }>();
    for (const d of filtered) {
      const key = d.project_id || AVULSAS_KEY;
      const title = d.project_id ? (d.project_title as string) || 'Projeto' : 'Demandas avulsas';
      if (!map.has(key)) map.set(key, { key, title, items: [] });
      map.get(key)!.items.push(d);
    }
    return [...map.values()].sort((a, b) => {
      if (a.key === AVULSAS_KEY) return 1;
      if (b.key === AVULSAS_KEY) return -1;
      return a.title.localeCompare(b.title, 'pt-BR');
    });
  }, [filtered]);

  // Nome do projeto filtrado (de qualquer demanda dele) p/ o banner.
  const projectFilterName = useMemo(
    () => (projectFilter ? (demands.find((d) => d.project_id === projectFilter)?.project_title as string) || 'projeto' : null),
    [projectFilter, demands],
  );

  const current = useMemo(() => demands.find((d) => d.id === currentId) || null, [demands, currentId]);
  const currentMsgs = currentId ? messages[currentId] || [] : [];
  const currentMembers = currentId ? members[currentId] || [] : [];
  const operators = currentMembers.filter((m) => m.role === 'operator');

  // Pessoas envolvidas = operadores ATRIBUÍDOS + quem da equipe/externo já RESPONDEU
  // no chat (autores não-cliente). Dedup por nome.
  const involvedPeople = useMemo(() => {
    const map = new Map<string, { key: string; name: string; role: string; color?: string | null; approved?: boolean }>();
    operators.forEach((o) => {
      const name = o.user_name || o.user_email || 'Operador';
      map.set(name.toLowerCase(), {
        key: 'op:' + String(o.id),
        name,
        role: o.position_name || 'Operador',
        color: o.position_color,
        approved: !!o.approved_finish,
      });
    });
    currentMsgs.forEach((m) => {
      if (m.author_role && m.author_role !== 'user' && m.author_name) {
        const k = m.author_name.toLowerCase();
        if (!map.has(k)) map.set(k, { key: 'msg:' + m.author_name, name: m.author_name, role: 'Equipe' });
      }
    });
    return [...map.values()];
  }, [operators, currentMsgs]);

  // ── Briefing desta demanda (F1) — só quando há projeto vinculado ──
  // Mostra: Briefing Básico (acessos do cliente) + briefing do projeto vinculado.
  const briefingSections = useMemo<BriefingViewSection[]>(() => {
    const pid = current?.project_id;
    if (!pid) return []; // demanda sem projeto → seção oculta
    const project = projectsById[pid];
    if (!project) return [];
    const services = project.services || [];
    const { general, services: svcAns } = normalizeProjectBriefing(project.briefing);

    const out: BriefingViewSection[] = [];
    // 1) Briefing do projeto: bloco geral + campanha por serviço.
    out.push(buildGeneralSection(general));
    services.forEach((svc) => {
      const lbl = BRIEFING_SERVICE_LABELS[svc] || svc;
      out.push(...buildProjectSections(svc, lbl, svcAns[svc] || {}));
    });
    // 2) Briefing Básico (acessos) — só os serviços deste projeto.
    services.forEach((svc) => {
      const lbl = BRIEFING_SERVICE_LABELS[svc] || svc;
      out.push(...buildAccessSections(svc, lbl, basicAccess[svc] || {}));
    });
    return out;
  }, [current?.project_id, projectsById, basicAccess]);
  const hasBriefing = briefingSections.some((sec) => sec.rows.length > 0);

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

  // ── Aprovar entrega e concluir (cliente, só quando "Em revisão") ──
  // A equipe entrega e marca "Em revisão"; o cliente aprova → demanda vira `done`,
  // o que dispara o convite de avaliação (abrimos o modal na sequência).
  const canComplete = current?.status === 'review';

  async function doComplete() {
    if (!currentId || !current || current.status !== 'review') return;
    if (!window.confirm('Aprovar a entrega e concluir esta demanda?')) return;
    try {
      await clientCompleteDemand(currentId);
      const updated = await getDemand(currentId);
      if (updated) setDemands((prev) => prev.map((x) => (x.id === currentId ? updated : x)));
      toast('Demanda concluída! Obrigado. 🎉', 'success');
    } catch (e) {
      toast(errMessage(e), 'error');
    }
  }

  // ── Pedir ajustes (cliente, só quando "Em revisão") → reabre a demanda ──
  async function doRequestChanges() {
    if (!currentId || !current || current.status !== 'review' || !me) return;
    const note = window.prompt('O que precisa ser ajustado? Descreva para a equipe:');
    if (note === null) return; // cancelou
    const trimmed = note.trim();
    if (!trimmed) {
      toast('Descreva o que precisa ser ajustado.', 'warning');
      return;
    }
    try {
      await clientRequestChanges(currentId);
      // Posta a nota como mensagem (reusa o sync de chat → ClickUp). Best-effort.
      try {
        const inserted = (await postMessage(currentId, `🔁 Ajustes solicitados: ${trimmed}`, [], me.id, me.client_slug || '')) as
          | { id?: string | number }
          | null;
        if (inserted?.id != null) await appendMessage(currentId, String(inserted.id));
      } catch {
        /* a nota é best-effort; o status já voltou para "Em andamento" */
      }
      const updated = await getDemand(currentId);
      if (updated) setDemands((prev) => prev.map((x) => (x.id === currentId ? updated : x)));
      toast('Ajustes solicitados. A equipe foi avisada e o chat está aberto.', 'success');
    } catch (e) {
      toast(errMessage(e), 'error');
    }
  }

  // ── Etapas (timeline) ── reflete o status real: aberta → equipe → revisão → concluída
  function renderSteps() {
    if (!current) return null;
    const s = current.status;
    const opCount = operators.length;

    if (s === 'canceled') {
      return (
        <div className={styles.steps}>
          <div className={`${styles.step} ${styles.done}`}>
            <span className={styles.dot}><Check /></span>
            <span>
              <span className={styles.stepTitle}>Demanda aberta</span>
              <span className={styles.stepWhen}>{fmtDate(current.created_at)}</span>
            </span>
          </div>
          <div className={`${styles.step} ${styles.current}`}>
            <span className={styles.dot} />
            <span>
              <span className={styles.stepTitle}>Cancelada</span>
              <span className={styles.stepWhen}>Esta demanda foi cancelada</span>
            </span>
          </div>
        </div>
      );
    }

    const working = s === 'open' || s === 'in_progress';
    const workDone = s === 'review' || s === 'done';
    const reviewDone = s === 'done';
    return (
      <div className={styles.steps}>
        <div className={`${styles.step} ${styles.done}`}>
          <span className={styles.dot}><Check /></span>
          <span>
            <span className={styles.stepTitle}>Demanda aberta</span>
            <span className={styles.stepWhen}>{fmtDate(current.created_at)}</span>
          </span>
        </div>
        <div className={`${styles.step} ${workDone ? styles.done : working ? styles.current : ''}`}>
          <span className={styles.dot}>{workDone && <Check />}</span>
          <span>
            <span className={styles.stepTitle}>Equipe trabalhando</span>
            <span className={styles.stepWhen}>
              {opCount} operador{opCount === 1 ? '' : 'es'}
            </span>
          </span>
        </div>
        <div className={`${styles.step} ${reviewDone ? styles.done : s === 'review' ? styles.current : ''}`}>
          <span className={styles.dot}>{reviewDone && <Check />}</span>
          <span>
            <span className={styles.stepTitle}>Em revisão</span>
            <span className={styles.stepWhen}>
              {s === 'review' ? 'Aguardando sua aprovação' : reviewDone ? 'Aprovada por você' : 'Aguardando entrega da equipe'}
            </span>
          </span>
        </div>
        <div className={`${styles.step} ${s === 'done' ? styles.done : ''}`}>
          <span className={styles.dot}>{s === 'done' && <Check />}</span>
          <span>
            <span className={styles.stepTitle}>Concluída</span>
            <span className={styles.stepWhen}>{s === 'done' ? fmtDate(current.finalized_at) : '—'}</span>
          </span>
        </div>
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


  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  // Item da lista (reusado no modo plano e dentro das pastas por projeto).
  const renderDemandItem = (d: Demand) => {
    const urg = dueUrgency(d);
    const unread = isUnread(d);
    return (
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
          <span className={styles.listTitle} style={{ display: 'block', fontWeight: unread ? 700 : undefined }}>
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
            <span
              style={
                urg === 'late'
                  ? { color: 'var(--danger-strong)', fontWeight: 600 }
                  : urg === 'soon'
                    ? { color: 'var(--warning-strong)', fontWeight: 600 }
                    : undefined
              }
            >
              {dueLabel(d)}
            </span>
          </span>
          {d.last_message_preview ? (
            <span
              className={styles.listMeta}
              style={{ display: 'block', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: unread ? 1 : 0.9 }}
            >
              <span style={{ fontWeight: unread ? 600 : 500 }}>
                {d.last_message_from === 'client' ? 'Você: ' : 'Equipe: '}
              </span>
              {(d.last_message_preview as string).replace(/\s+/g, ' ').slice(0, 80)}
            </span>
          ) : null}
        </span>
        {unread ? (
          <span
            aria-label="Mensagens novas"
            title="Mensagens novas"
            style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, alignSelf: 'center' }}
          />
        ) : (
          <span />
        )}
      </button>
    );
  };

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
                Precisam de você <span className={styles.cnt}>{counts.awaiting}</span>
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
          {projectFilter && (
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', margin: '0 0 6px', background: 'var(--accent-soft)', borderRadius: 10, fontSize: '0.8rem' }}
            >
              <span style={{ color: 'var(--accent-strong)', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                📁 {projectFilterName}
              </span>
              <button type="button" onClick={clearProjectFilter} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}>
                Ver todas
              </button>
            </div>
          )}
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
              <div className={styles.empty}>
                {filter === 'all' && !search && demands.length === 0 ? (
                  <>
                    <p style={{ marginBottom: 12 }}>Você ainda não abriu nenhuma demanda.</p>
                    <button type="button" className="btn-primary" onClick={() => void openNewDemand()}>
                      + Abrir primeira demanda
                    </button>
                  </>
                ) : (
                  <>
                    <p style={{ marginBottom: 10 }}>Nenhuma demanda neste filtro.</p>
                    <button
                      type="button"
                      onClick={() => { setFilter('all'); setSearch(''); }}
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Ver todas as demandas
                    </button>
                  </>
                )}
              </div>
            ) : projectFilter ? (
              // Filtro de projeto ativo → lista plana (o chip acima já indica o projeto).
              filtered.map((d) => renderDemandItem(d))
            ) : (
              // Organização em PASTAS por projeto (colapsáveis); avulsas por último.
              groups.map((g) => {
                const isCollapsed = collapsedGroups.has(g.key);
                return (
                  <div key={g.key}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.key)}
                      aria-expanded={!isCollapsed}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        padding: '9px 12px',
                        margin: '8px 0 2px',
                        background: 'none',
                        border: 'none',
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: 'var(--muted)',
                      }}
                    >
                      <span style={{ fontSize: '0.9rem' }}>{g.key === AVULSAS_KEY ? '⚡' : '📁'}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                        {g.title}
                      </span>
                      <span
                        style={{
                          flexShrink: 0,
                          background: 'var(--accent-soft)',
                          color: 'var(--accent-strong)',
                          borderRadius: 999,
                          padding: '1px 8px',
                          fontSize: '0.72rem',
                        }}
                      >
                        {g.items.length}
                      </span>
                      <span style={{ flexShrink: 0, fontSize: '0.7rem' }}>{isCollapsed ? '▸' : '▾'}</span>
                    </button>
                    {!isCollapsed && g.items.map((d) => renderDemandItem(d))}
                  </div>
                );
              })
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
                    {current.project_title ? (
                      <span
                        title="Projeto"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent-strong)', fontSize: '0.72rem', fontWeight: 600 }}
                      >
                        📁 {current.project_title}
                      </span>
                    ) : null}
                    {current.starts_at ? <span>Início {fmtDate(current.starts_at)}</span> : null}
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
                        {m.content && (
                          <span className={styles.msgBubble} style={{ display: 'block', opacity: m._pending ? 0.65 : 1 }}>
                            {m.content}
                          </span>
                        )}
                        {renderAttachments(m.attachments)}
                        <span className={styles.msgTime} style={{ display: 'block', textAlign: mine ? 'right' : 'left' }}>
                          {m._failed ? (
                            <span style={{ color: 'var(--danger-strong)' }}>não enviado</span>
                          ) : m._pending ? (
                            'enviando…'
                          ) : (
                            fmtTime(m.created_at)
                          )}
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
              const did = currentId;
              // ── UI otimista: a mensagem aparece NA HORA; o insert + sync ClickUp
              //    (criar pasta/tarefa/comentário) acontecem em segundo plano. ──
              const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const optimistic: ChatMessage = {
                id: tempId,
                user_id: me.id,
                content,
                attachments: attachments ?? [],
                origin: 'portal',
                created_at: new Date().toISOString(),
                author_name: me.name ?? 'Você',
                author_role: 'client',
                avatar_url: me.metadata?.avatar_url ?? null,
                _pending: true,
              };
              setMessages((prev) => ({ ...prev, [did]: [...(prev[did] || []), optimistic] }));
              markRead(did, optimistic.created_at);

              // Envia em segundo plano (não trava o composer nem o input).
              void (async () => {
                try {
                  const inserted = (await postMessage(did, content, attachments ?? [], me.id, me.client_slug || '')) as
                    | { id?: string | number }
                    | null;
                  const realId = inserted?.id != null ? String(inserted.id) : null;
                  setMessages((prev) => {
                    const list = prev[did] || [];
                    if (!realId) {
                      return { ...prev, [did]: list.map((m) => (m.id === tempId ? { ...m, _failed: true, _pending: false } : m)) };
                    }
                    // Se o realtime já trouxe a versão real, descarta a otimista;
                    // senão, converte a otimista no id real (dedup por id evita duplicar).
                    const hasReal = list.some((m) => m.id === realId);
                    const next = hasReal
                      ? list.filter((m) => m.id !== tempId)
                      : list.map((m) => (m.id === tempId ? { ...m, id: realId, _pending: false } : m));
                    return { ...prev, [did]: next };
                  });
                } catch (e) {
                  setMessages((prev) => ({
                    ...prev,
                    [did]: (prev[did] || []).map((m) => (m.id === tempId ? { ...m, _failed: true, _pending: false } : m)),
                  }));
                  toast('Não foi possível enviar: ' + errMessage(e), 'error');
                }
              })();
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

              <div className={styles.detailSection}>
                <h3>
                  Pessoas envolvidas{' '}
                  <span className="small">
                    {involvedPeople.length} pessoa{involvedPeople.length === 1 ? '' : 's'}
                  </span>
                </h3>
                <div className={styles.teamMini}>
                  {involvedPeople.length === 0 ? (
                    <div className="muted" style={{ fontSize: '0.84rem' }}>
                      Ninguém da equipe ainda — assim que alguém for atribuído ou responder, aparece aqui.
                    </div>
                  ) : (
                    involvedPeople.map((m) => (
                      <div key={m.key} className={styles.teamItem}>
                        <span
                          className={styles.teamAvatar}
                          style={
                            m.color
                              ? { background: `linear-gradient(135deg, ${m.color}33, ${m.color})` }
                              : undefined
                          }
                        >
                          {initials(m.name)}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, display: 'block' }}>{m.name || '—'}</span>
                          <span className={styles.teamRole}>{m.role || '—'}</span>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {current.project_id && hasBriefing && (
                <div className={styles.detailSection}>
                  <h3>Briefing do projeto</h3>
                  <Link
                    href={`/portal/briefing/${current.project_id}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 16px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--accent-soft)',
                      color: 'var(--accent-strong)',
                      fontWeight: 700,
                      fontSize: '0.88rem',
                      textDecoration: 'none',
                    }}
                  >
                    📁 {current.project_title || 'Abrir briefing completo'} →
                  </Link>
                </div>
              )}

              {canComplete && (
                <div className={styles.detailSection}>
                  <button type="button" className={styles.finalizeBtn} onClick={() => void doComplete()}>
                    Aprovar entrega e concluir
                  </button>
                  <button type="button" className={styles.requestBtn} onClick={() => void doRequestChanges()}>
                    Pedir ajustes
                  </button>
                  <small className={styles.finalizeHint}>
                    A equipe enviou para sua aprovação. Aprove para concluir, ou peça ajustes para reabrir o chat.
                  </small>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {showNew && <NewDemandModal onClose={() => setShowNew(false)} onCreated={(d) => void onDemandCreated(d)} />}

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
