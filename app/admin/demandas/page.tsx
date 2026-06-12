'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createClient } from '@/lib/supabase/client';
import { initials } from '@/lib/format';
import { toast } from '@/lib/toast';
import {
  listAllDemands,
  adminDemandStats,
  listClientsSimple,
  loadMembersByDemand,
  loadOperatorUsers,
  type Demand,
  type DemandStats,
  type DemandFilter,
  type DemandMemberLite,
  type OperatorUser,
  type ClientSimple,
} from '@/lib/api/admin-demandas';
import { DemandCard, StudentDemandCard } from '@/components/admin/DemandCard';
import DemandDetailModal from '@/components/admin/DemandDetailModal';
import styles from './demandas.module.css';

type ViewMode = 'kanban' | 'students';

const VIEW_KEY = 'admin_demands_view';
const COLLAPSED_KEY = 'admin_demands_collapsed';

const EMPTY_STATS: DemandStats = {
  total: 0,
  open: 0,
  in_progress: 0,
  review: 0,
  done: 0,
  canceled: 0,
};

function readCollapsed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export default function AdminDemandasPage() {
  const [stats, setStats] = useState<DemandStats>(EMPTY_STATS);
  const [demands, setDemands] = useState<Demand[]>([]);
  const [membersById, setMembersById] = useState<Record<string, DemandMemberLite[]>>({});
  const [usersById, setUsersById] = useState<Record<string, OperatorUser>>({});
  const [clients, setClients] = useState<ClientSimple[]>([]);

  const [search, setSearch] = useState('');
  const [clientSlug, setClientSlug] = useState('all');
  const [view, setView] = useState<ViewMode>('kanban');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Filtro corrente sempre fresco para o realtime/reload.
  const filterRef = useRef<DemandFilter>({ search: '', clientSlug: 'all' });
  filterRef.current = { search, clientSlug };
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([
        adminDemandStats(),
        listAllDemands(filterRef.current),
      ]);
      setStats(s);
      setDemands(list);

      const membersMap = await loadMembersByDemand(list.map((d) => d.id));
      setMembersById(membersMap);

      const opIds = [
        ...new Set(
          Object.values(membersMap)
            .flat()
            .filter((m) => m.role === 'operator')
            .map((m) => m.user_id),
        ),
      ];
      setUsersById(await loadOperatorUsers(opIds));
    } catch (e) {
      console.error(e);
      toast('Erro ao carregar demandas: ' + ((e as Error).message || e), 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Restaura preferência de visão + carga inicial + clientes.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'students' || saved === 'kanban') setView(saved);
    } catch {
      /* noop */
    }
    listClientsSimple()
      .then(setClients)
      .catch((e) => console.error(e));
    loadAll();
  }, [loadAll]);

  // Realtime: demands + demand_members → reload.
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel('admin-demands')
      .on('postgres_changes', { event: '*', schema: 'portal', table: 'demands' }, () => loadAll())
      .on(
        'postgres_changes',
        { event: '*', schema: 'portal', table: 'demand_members' },
        () => loadAll(),
      )
      .subscribe();
    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {
        /* noop */
      }
    };
  }, [loadAll]);

  function onSearchChange(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadAll(), 280);
  }

  function onClientChange(value: string) {
    setClientSlug(value);
    // filterRef é atualizado a cada render; lemos o novo valor já aqui.
    filterRef.current = { search, clientSlug: value };
    loadAll();
  }

  function changeView(next: ViewMode) {
    if (next === view) return;
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* noop */
    }
  }

  function toggleStudent(slug: string) {
    setCollapsed((prev) => {
      const nxt = new Set(prev);
      if (nxt.has(slug)) nxt.delete(slug);
      else nxt.add(slug);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...nxt]));
      } catch {
        /* noop */
      }
      return nxt;
    });
  }

  // ── Kanban: agrupa por status (exclui canceled) ──
  const columns = useMemo(() => {
    const map: Record<'open' | 'in_progress' | 'review' | 'done', Demand[]> = {
      open: [],
      in_progress: [],
      review: [],
      done: [],
    };
    demands.forEach((d) => {
      if (d.status === 'canceled') return;
      if (map[d.status as keyof typeof map]) map[d.status as keyof typeof map].push(d);
    });
    return map;
  }, [demands]);

  // ── View por aluno: agrupa por client_slug ──
  const studentGroups = useMemo(() => {
    const byClient: Record<string, Demand[]> = {};
    demands.forEach((d) => {
      (byClient[d.client_slug] ||= []).push(d);
    });

    let list: ClientSimple[] = clients;
    if (clientSlug !== 'all') list = list.filter((c) => c.slug === clientSlug);

    list = [...list].sort((a, b) => {
      const da = (byClient[a.slug] || []).filter(
        (d) => d.status !== 'done' && d.status !== 'canceled',
      ).length;
      const db = (byClient[b.slug] || []).filter(
        (d) => d.status !== 'done' && d.status !== 'canceled',
      ).length;
      if (db !== da) return db - da;
      return (a.display_name || a.slug).localeCompare(b.display_name || b.slug);
    });

    // Defensivo: clientes com demandas mas fora da lista.
    Object.keys(byClient).forEach((slug) => {
      if (!list.some((c) => c.slug === slug)) {
        list = [...list, { slug, display_name: byClient[slug][0]?.client_name || slug }];
      }
    });

    // Com busca ativa, só clientes com pelo menos uma demanda casando.
    const hasSearch = !!search.trim();
    if (hasSearch) list = list.filter((c) => (byClient[c.slug] || []).length > 0);

    const order: Record<string, number> = {
      review: 0,
      in_progress: 1,
      open: 2,
      done: 3,
      canceled: 4,
    };

    return list
      .map((c) => {
        const ds = byClient[c.slug] || [];
        if (ds.length === 0 && hasSearch) return null;
        const open = ds.filter((d) => d.status === 'open').length;
        const prog = ds.filter((d) => d.status === 'in_progress').length;
        const review = ds.filter((d) => d.status === 'review').length;
        const done = ds.filter((d) => d.status === 'done').length;
        const sorted = ds
          .filter((d) => d.status !== 'canceled')
          .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
        return { client: c, total: ds.length, open, prog, review, done, sorted };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [demands, clients, clientSlug, search]);

  const kpis: Array<{ key: keyof DemandStats; label: string; bg: string; color: string; icon: ReactElement }> = [
    {
      key: 'total',
      label: 'Total',
      bg: '#dbeafe',
      color: '#1d4ed8',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      ),
    },
    {
      key: 'open',
      label: 'Abertas',
      bg: '#dbeafe',
      color: '#1d4ed8',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      key: 'in_progress',
      label: 'Em andamento',
      bg: '#fff4d6',
      color: '#eab308',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      ),
    },
    {
      key: 'review',
      label: 'Em revisão',
      bg: '#ffe9ee',
      color: '#ec4899',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
    },
    {
      key: 'done',
      label: 'Concluídas',
      bg: '#e7f7ee',
      color: '#16a34a',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ),
    },
  ];

  const colDefs: Array<{
    key: 'open' | 'in_progress' | 'review' | 'done';
    label: string;
    dotCls: string;
  }> = [
    { key: 'open', label: 'Aberta', dotCls: styles.dotOpen },
    { key: 'in_progress', label: 'Em andamento', dotCls: styles.dotProg },
    { key: 'review', label: 'Em revisão', dotCls: styles.dotReview },
    { key: 'done', label: 'Concluída', dotCls: styles.dotDone },
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Demandas — Serviços Diamante</h1>
          <p className={styles.subtitle}>
            Acompanhe o fluxo de cada solicitação dos alunos em tempo real.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className={styles.kpiGrid}>
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div className={styles.skelKpi} key={i}>
                <div className={`${styles.skel} ${styles.skelIcon}`} />
                <div style={{ flex: 1 }}>
                  <div className={`${styles.skel} ${styles.skelLine}`} style={{ width: '60%', marginBottom: 6 }} />
                  <div className={`${styles.skel} ${styles.skelLine}`} style={{ width: '36%', height: 18 }} />
                </div>
              </div>
            ))
          : kpis.map((k) => (
              <div className={styles.kpiCard} key={k.key}>
                <div className={styles.kpiIcon} style={{ background: k.bg, color: k.color }}>
                  {k.icon}
                </div>
                <div>
                  <div className={styles.kpiLabel}>{k.label}</div>
                  <div className={styles.kpiValue}>{stats[k.key]}</div>
                </div>
              </div>
            ))}
      </div>

      {/* Filtros + toggle */}
      <div className={styles.filters}>
        <div className={styles.searchWrap}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Buscar por título, cliente ou descrição"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <select
          className={styles.selectPill}
          value={clientSlug}
          onChange={(e) => onClientChange(e.target.value)}
        >
          <option value="all">Cliente: Todos</option>
          {clients.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.display_name || c.slug}
            </option>
          ))}
        </select>
        <div className={styles.viewToggle} role="tablist">
          <button
            type="button"
            className={view === 'kanban' ? styles.toggleActive : ''}
            onClick={() => changeView('kanban')}
            title="Visão Kanban por status"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="18" />
              <rect x="14" y="3" width="7" height="11" />
            </svg>
            Por status
          </button>
          <button
            type="button"
            className={view === 'students' ? styles.toggleActive : ''}
            onClick={() => changeView('students')}
            title="Visão agrupada por aluno"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Por aluno
          </button>
        </div>
        <button className={styles.btnRefresh} onClick={() => loadAll()} title="Atualizar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Atualizar
        </button>
      </div>

      {/* View: por aluno */}
      {view === 'students' && (
        <div className={styles.studentsView}>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div className={styles.studentBlock} key={i}>
                <div className={styles.studentHead} style={{ cursor: 'default' }}>
                  <div className={styles.studentHeadLeft}>
                    <div className={`${styles.skel} ${styles.skelIcon}`} style={{ borderRadius: '50%' }} />
                    <div style={{ flex: 1 }}>
                      <div className={`${styles.skel} ${styles.skelLine}`} style={{ width: 160, marginBottom: 6 }} />
                      <div className={`${styles.skel} ${styles.skelLine}`} style={{ width: 90, height: 9 }} />
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : studentGroups.length === 0 ? (
            <div className={styles.studentsEmpty}>Nenhum aluno encontrado.</div>
          ) : (
            studentGroups.map(({ client, total, open, prog, review, done, sorted }) => {
              const isCollapsed = collapsed.has(client.slug);
              return (
                <div
                  key={client.slug}
                  className={`${styles.studentBlock} ${isCollapsed ? styles.collapsed : ''}`}
                >
                  <div className={styles.studentHead} onClick={() => toggleStudent(client.slug)}>
                    <div className={styles.studentHeadLeft}>
                      <div className={styles.avatar}>
                        {initials(client.display_name || client.slug)}
                      </div>
                      <div>
                        <div className={styles.studentName}>
                          {client.display_name || client.slug}
                        </div>
                        <div className={styles.studentMeta}>
                          {total} demanda{total === 1 ? '' : 's'} no total
                        </div>
                      </div>
                    </div>
                    <div className={styles.studentHeadRight}>
                      {review > 0 && (
                        <span className={`${styles.studentCounter} ${styles.cReview}`}>
                          {review} em revisão
                        </span>
                      )}
                      {prog > 0 && (
                        <span className={`${styles.studentCounter} ${styles.cProg}`}>
                          {prog} em andamento
                        </span>
                      )}
                      {open > 0 && <span className={styles.studentCounter}>{open} abertas</span>}
                      {done > 0 && (
                        <span className={`${styles.studentCounter} ${styles.cDone}`}>
                          {done} concluídas
                        </span>
                      )}
                      {review === 0 && prog === 0 && open === 0 && done === 0 && (
                        <span className={styles.studentCounter}>Sem demandas</span>
                      )}
                      <div className={styles.studentCaret}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div className={styles.studentBody}>
                    {sorted.length > 0 ? (
                      sorted.map((d) => (
                        <StudentDemandCard
                          key={d.id}
                          demand={d}
                          members={membersById[d.id] || []}
                          usersById={usersById}
                          onOpen={setDetailId}
                        />
                      ))
                    ) : (
                      <div className={styles.empty}>Sem demandas ativas.</div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* View: Kanban */}
      {view === 'kanban' && (
        <div className={styles.kanban}>
          {colDefs.map((col) => {
            const items = columns[col.key];
            return (
              <div className={styles.kcol} key={col.key}>
                <div className={styles.kcolHead}>
                  <div className={styles.kcolTitle}>
                    <span className={`${styles.kcolDot} ${col.dotCls}`} />
                    {col.label}
                  </div>
                  <span className={styles.kcolCount}>{items.length}</span>
                </div>
                <div className={styles.kcards}>
                  {loading ? (
                    Array.from({ length: 2 }).map((_, i) => (
                      <div className={styles.skelCard} key={i}>
                        <div className={`${styles.skel} ${styles.skelLine}`} style={{ width: '80%' }} />
                        <div className={`${styles.skel} ${styles.skelLine}`} style={{ width: '50%', height: 9 }} />
                        <div className={`${styles.skel} ${styles.skelLine}`} style={{ width: '100%', height: 9 }} />
                      </div>
                    ))
                  ) : items.length > 0 ? (
                    items.map((d) => (
                      <DemandCard
                        key={d.id}
                        demand={d}
                        members={membersById[d.id] || []}
                        usersById={usersById}
                        onOpen={setDetailId}
                      />
                    ))
                  ) : (
                    <div className={styles.empty}>Nada por aqui.</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detailId && (
        <DemandDetailModal
          demandId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={loadAll}
        />
      )}
    </div>
  );
}
