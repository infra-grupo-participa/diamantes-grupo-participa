'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { initials, fmtBRL, fmtDate, canonicalSector } from '@/lib/format';
import {
  listSubscriptions,
  getSubscriptionStats,
  getMrrSparkline,
  getServicesByType,
  getPurchaseMonthlyStats,
  getServiceRenewals,
  listPurchasesHistory,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  listClientsForSubscription,
  exportSubscriptionsCsv,
  exportPurchasesCsv,
  downloadBlob,
  type SubscriptionRow,
  type SubscriptionStats,
  type SparkPoint,
  type ServiceByType,
  type MonthlyStat,
  type ServiceRenewal,
  type PurchaseRow,
  type ClientOption,
  type SubscriptionPayload,
} from '@/lib/api/admin-assinaturas';
import s from './assinaturas.module.css';

// Mapa por setor (saída de canonicalSector)
const SERVICE_COLORS: Record<string, string> = {
  'Gestor de Tráfego': 'pink',
  'Social Media': 'pink',
  'Web Designer': 'blue',
  Hospedagem: 'yellow',
  Designer: 'purple',
  'Editor de Vídeo': 'yellow',
  Automação: 'orange',
  Copywriter: 'green',
};

const PAGE_SIZES = [10, 25, 50];
const HIST_PAGE_SIZE = 15;

function statusBadge(status: string): { cls: string; txt: string } {
  const map: Record<string, { cls: string; txt: string }> = {
    paid: { cls: s.badgeGreen, txt: 'Em dia' },
    overdue: { cls: s.badgeRed, txt: 'Em atraso' },
    late: { cls: s.badgeRed, txt: 'Em atraso' },
    pending: { cls: s.badgeYellow, txt: 'Pendente' },
    canceled: { cls: s.badgeGray, txt: 'Cancelado' },
    paused: { cls: s.badgeGray, txt: 'Pausado' },
    trial: { cls: s.badgeYellow, txt: 'Trial' },
  };
  return map[status] || { cls: s.badgeYellow, txt: status || '—' };
}

function pmIconLabel(method?: string | null): { cls: string; label: string } {
  if (method === 'cc') return { cls: s.cc, label: 'CC' };
  if (method === 'pix') return { cls: s.pix, label: 'PIX' };
  if (method === 'boleto') return { cls: s.boleto, label: 'BB' };
  return { cls: '', label: 'OUT' };
}

function pmText(sub: SubscriptionRow): string {
  if (sub.payment_method === 'cc') return 'Cartão';
  if (sub.payment_method === 'pix') return 'PIX';
  if (sub.payment_method === 'boleto') return 'Boleto';
  return sub.payment_method_label || (sub.payment_method ? sub.payment_method.toUpperCase() : '—');
}

export default function AssinaturasClient() {
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingTable, setLoadingTable] = useState(true);
  const [tableError, setTableError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('all');

  const [stats, setStats] = useState<SubscriptionStats | null>(null);
  const [summary, setSummary] = useState<{ due: number; late: number; avg: number } | null>(null);
  const [spark, setSpark] = useState<SparkPoint[]>([]);
  const [servicesByType, setServicesByType] = useState<ServiceByType[]>([]);
  const [monthly, setMonthly] = useState<MonthlyStat[]>([]);
  const [renewals, setRenewals] = useState<ServiceRenewal[] | null>(null);

  // Histórico Hotmart
  const [histData, setHistData] = useState<PurchaseRow[]>([]);
  const [histCount, setHistCount] = useState(0);
  const [histPage, setHistPage] = useState(1);
  const [histMonth, setHistMonth] = useState('');
  const [histClient, setHistClient] = useState('');
  const [histLoading, setHistLoading] = useState(true);
  const [histClients, setHistClients] = useState<{ slug: string; name: string }[]>([]);

  const [modal, setModal] = useState<null | { editing: SubscriptionRow | null }>(null);

  // ── Tabela ──
  const load = useCallback(async () => {
    setLoadingTable(true);
    setTableError(null);
    try {
      const offset = (page - 1) * pageSize;
      const { data, count } = await listSubscriptions({ search, status, limit: pageSize, offset });
      setSubs(data);
      setTotal(count);
    } catch (e) {
      setTableError((e as Error).message || String(e));
      console.error(e);
    } finally {
      setLoadingTable(false);
    }
  }, [page, pageSize, search, status]);

  const loadStats = useCallback(async () => {
    try {
      const st = await getSubscriptionStats();
      setStats(st);

      const { data: all } = await listSubscriptions({ limit: 1000, offset: 0 });
      const due = all.filter((x) => x.status === 'pending').reduce((acc, x) => acc + Number(x.monthly_value || 0), 0);
      const late = all
        .filter((x) => x.status === 'overdue' || x.status === 'late' || x.status === 'partial')
        .reduce((acc, x) => acc + Number(x.monthly_value || 0), 0);
      const active = all.filter((x) => x.status !== 'canceled');
      const avg = active.length ? active.reduce((acc, x) => acc + Number(x.monthly_value || 0), 0) / active.length : 0;
      setSummary({ due, late, avg });

      const [sp, svc, mo] = await Promise.all([getMrrSparkline(), getServicesByType(), getPurchaseMonthlyStats()]);
      setSpark(sp);
      setServicesByType(svc);
      setMonthly(mo);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadRenewals = useCallback(async () => {
    try {
      setRenewals(await getServiceRenewals());
    } catch (e) {
      console.error('loadServiceRenewals', e);
      setRenewals([]);
    }
  }, []);

  const loadHist = useCallback(async () => {
    setHistLoading(true);
    try {
      const offset = (histPage - 1) * HIST_PAGE_SIZE;
      const { data, count } = await listPurchasesHistory({
        limit: HIST_PAGE_SIZE,
        offset,
        month: histMonth,
        clientSlug: histClient,
      });
      setHistData(data);
      setHistCount(count);
    } catch (e) {
      console.error(e);
    } finally {
      setHistLoading(false);
    }
  }, [histPage, histMonth, histClient]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadStats();
  }, [loadStats]);
  useEffect(() => {
    loadRenewals();
  }, [loadRenewals]);
  useEffect(() => {
    loadHist();
  }, [loadHist]);

  // Filtros do histórico (clientes)
  useEffect(() => {
    (async () => {
      try {
        const { data } = await listSubscriptions({ limit: 200, offset: 0 });
        setHistClients(data.map((x) => ({ slug: x.client_slug, name: x.client_name })));
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const histMonthOptions = useMemo(
    () =>
      monthly
        .slice()
        .reverse()
        .map((m) => {
          const [y, mo] = m.month.split('-');
          const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
          return { value: m.month, label };
        }),
    [monthly],
  );

  // Debounce busca
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearchChange(v: string) {
    setSearchInput(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(v);
      setPage(1);
    }, 280);
  }

  async function onDelete(sub: SubscriptionRow) {
    if (!confirm(`Excluir assinatura de ${sub.client_name}?`)) return;
    try {
      await deleteSubscription(sub.id);
      toast('Assinatura excluída.');
      await Promise.all([load(), loadStats()]);
    } catch (e) {
      toast('Erro: ' + ((e as Error).message || e), 'error');
    }
  }

  async function onExportSubs() {
    try {
      const blob = await exportSubscriptionsCsv();
      downloadBlob(blob, `assinaturas-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      toast('Erro ao exportar: ' + ((e as Error).message || e), 'error');
    }
  }
  async function onExportPurchases() {
    try {
      const blob = await exportPurchasesCsv();
      downloadBlob(blob, `compras-hotmart-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      toast('Erro ao exportar: ' + ((e as Error).message || e), 'error');
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + 4);
    const arr: number[] = [];
    for (let i = start; i <= end; i++) arr.push(i);
    return arr;
  }, [page, totalPages]);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const monthLabel = useMemo(() => {
    const m = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return m.charAt(0).toUpperCase() + m.slice(1);
  }, []);

  const histTotalPages = Math.ceil(histCount / HIST_PAGE_SIZE);

  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <div>
          <h1 className={s.title}>Assinaturas</h1>
          <p className={s.subtitle}>Acompanhe os assinantes, pagamentos e receitas recorrentes.</p>
        </div>
        <div className={s.actions}>
          <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onExportPurchases}>
            <ExportIcon />
            Exportar compras Hotmart
          </button>
          <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onExportSubs}>
            <ExportIcon />
            Exportar assinaturas
          </button>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setModal({ editing: null })}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nova assinatura
          </button>
        </div>
      </div>

      {/* Coluna 1: KPIs + tabela */}
      <div className={s.col}>
        <div className={s.kpiGrid}>
          <Kpi label="Receita" value={stats ? fmtBRL(stats.mrr) : '—'} bg="#eaf2ff" color="#3b82f6" icon="dollar" />
          <Kpi label="Assinantes ativos" value={stats?.active ?? '—'} bg="#f1ecff" color="#8b5cf6" icon="users" />
          <Kpi label="Inadimplentes" value={stats ? (stats.late || 0) + (stats.partial || 0) : '—'} bg="#fee2e2" color="#ef4444" icon="alert" />
          <Kpi label="Pendentes" value={stats?.pending ?? '—'} bg="#fff4d6" color="#eab308" icon="clock" />
          <Kpi label="Taxa de retenção" value={stats ? stats.retention + '%' : '—'} bg="#e7f7ee" color="#16a34a" icon="trend" />
        </div>

        <div className={s.tableCard}>
          <div className={s.tableHead}>
            <div>
              <h2>Lista de assinaturas</h2>
              <p>Visualize cada aluno, plano, pagamento e status atual.</p>
            </div>
            <div className={s.controls}>
              <div className={s.searchWrap}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  className={s.input}
                  type="text"
                  placeholder="Buscar por aluno, plano ou email"
                  value={searchInput}
                  onChange={(e) => onSearchChange(e.target.value)}
                />
              </div>
              <select
                className={s.select}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Status: Todos</option>
                <option value="paid">Em dia</option>
                <option value="overdue">Em atraso</option>
                <option value="pending">Pendentes</option>
                <option value="canceled">Cancelados</option>
              </select>
            </div>
          </div>

          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>Valor mensal</th>
                  <th title="Calculado com base na data de início do contrato">Próxima cobrança</th>
                  <th>Pagamento</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {loadingTable ? (
                  Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                ) : tableError ? (
                  <tr>
                    <td colSpan={6} className={s.cellError}>
                      Erro ao carregar: {tableError}
                    </td>
                  </tr>
                ) : subs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={s.cellEmpty}>
                      Nenhuma assinatura encontrada.
                    </td>
                  </tr>
                ) : (
                  subs.map((sub) => (
                    <SubRow key={sub.id} sub={sub} onEdit={() => setModal({ editing: sub })} onDelete={() => onDelete(sub)} />
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className={s.pagination}>
            <span>
              Mostrando <strong>{first}–{last}</strong> de <strong>{total}</strong> assinaturas
            </span>
            <div className={s.pageSize}>
              <span>Itens por página</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(parseInt(e.target.value, 10) || 25);
                  setPage(1);
                }}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className={s.pageNav}>
              <button className={s.pageBtn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                ‹
              </button>
              {pageNumbers.map((n) => (
                <button key={n} className={`${s.pageBtn} ${n === page ? s.active : ''}`} onClick={() => setPage(n)}>
                  {n}
                </button>
              ))}
              <button className={s.pageBtn} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                ›
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Coluna 2: painel financeiro */}
      <aside className={s.panel}>
        <div className={s.panelCard}>
          <h3 className={s.panelTitle}>
            Receita recorrente (MRR) <span className={s.meta}>{monthLabel}</span>
          </h3>
          <MrrChart mrr={stats?.mrr ?? 0} months={spark} />
          <div className={s.miniStats}>
            <MiniStat label="MRR" value={stats ? fmtBRL(stats.mrr) : '—'} variant="pos" />
            <MiniStat label="A receber" value={summary ? fmtBRL(summary.due) : '—'} />
            <MiniStat label="Inadimplência" value={summary ? fmtBRL(summary.late) : '—'} variant="neg" />
            <MiniStat label="Ticket médio" value={summary ? fmtBRL(summary.avg) : '—'} />
          </div>
        </div>

        <div className={s.panelCard}>
          <h3 className={s.panelTitle}>Serviços mais contratados</h3>
          {servicesByType.length === 0 ? (
            <div className={s.placeholder} style={{ padding: 0 }}>
              Sem serviços ativos.
            </div>
          ) : (
            servicesByType.slice(0, 8).map((svc) => {
              const max = servicesByType[0]?.count || 1;
              const color = SERVICE_COLORS[svc.type] || 'orange';
              const pct = Math.round((svc.count / max) * 100);
              return (
                <div key={svc.type} className={s.serviceBarItem}>
                  <div className={s.serviceBarHead}>
                    <span className={s.serviceBarName}>{svc.type}</span>
                    <span className={s.serviceBarCount}>{svc.count} contratos</span>
                  </div>
                  <div className={s.serviceBar}>
                    <div className={`${s.serviceBarFill} ${(s as Record<string, string>)[color]}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className={s.panelCard}>
          <h3 className={s.panelTitle}>Receita por mês</h3>
          {monthly.length === 0 ? (
            <div className={s.placeholder} style={{ padding: 0 }}>
              Sem dados.
            </div>
          ) : (
            monthly.map((m) => {
              const max = Math.max(...monthly.map((x) => x.total), 1);
              const pct = Math.round((m.total / max) * 100);
              const [y, mo] = m.month.split('-');
              const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
              return (
                <div key={m.month} className={s.serviceBarItem}>
                  <div className={s.serviceBarHead}>
                    <span className={s.serviceBarName}>{label}</span>
                    <span className={s.serviceBarCount}>
                      {fmtBRL(m.total)} · {m.count} cobr.
                    </span>
                  </div>
                  <div className={s.serviceBar}>
                    <div className={`${s.serviceBarFill} ${s.orange}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className={s.panelCard}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h3 className={s.panelTitle} style={{ margin: 0 }}>
              Próximos vencimentos por serviço
            </h3>
            <span className={s.meta}>{renewals == null ? '—' : renewals.length === 0 ? 'Nenhum' : `${renewals.length} próximos`}</span>
          </div>
          <div className={s.scrollBox}>
            <RenewalsList renewals={renewals} />
          </div>
        </div>

        <div className={s.panelCard}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h3 className={s.panelTitle} style={{ margin: 0 }}>
              Histórico de cobranças
            </h3>
            <div className={s.panelFilters}>
              <select
                className={s.miniSelect}
                value={histMonth}
                onChange={(e) => {
                  setHistMonth(e.target.value);
                  setHistPage(1);
                }}
              >
                <option value="">Todos os meses</option>
                {histMonthOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                className={s.miniSelect}
                value={histClient}
                onChange={(e) => {
                  setHistClient(e.target.value);
                  setHistPage(1);
                }}
              >
                <option value="">Todos os alunos</option>
                {histClients.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={s.scrollBoxTall}>
            <HistList loading={histLoading} data={histData} />
          </div>
          {histTotalPages > 1 && (
            <div className={s.histPager}>
              <button className={s.pageBtn} disabled={histPage <= 1} onClick={() => setHistPage((p) => p - 1)}>
                ‹
              </button>
              <span className={s.histPagerInfo}>
                {histPage}/{histTotalPages}
              </span>
              <button className={s.pageBtn} disabled={histPage >= histTotalPages} onClick={() => setHistPage((p) => p + 1)}>
                ›
              </button>
            </div>
          )}
        </div>
      </aside>

      {modal && (
        <SubModal
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await Promise.all([load(), loadStats()]);
          }}
        />
      )}
    </div>
  );
}

// ── Subcomponentes ──
function SkeletonRow() {
  return (
    <tr className={s.skelRow}>
      <td>
        <div className={s.skelUser}>
          <span className={`${s.skel} ${s.skelCircle}`} />
          <div className={s.skelUserText}>
            <span className={`${s.skel} ${s.skelLine}`} style={{ width: '70%' }} />
            <span className={`${s.skel} ${s.skelLine}`} style={{ width: '45%' }} />
          </div>
        </div>
      </td>
      <td><span className={`${s.skel} ${s.skelLine}`} style={{ width: 70 }} /></td>
      <td><span className={`${s.skel} ${s.skelLine}`} style={{ width: 80 }} /></td>
      <td><span className={`${s.skel} ${s.skelLine}`} style={{ width: 70 }} /></td>
      <td><span className={`${s.skel} ${s.skelLine}`} style={{ width: 64, height: 20, borderRadius: 999 }} /></td>
      <td><span className={`${s.skel} ${s.skelLine}`} style={{ width: 60, height: 28, marginLeft: 'auto' }} /></td>
    </tr>
  );
}

function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className={s.skelList}>
      {Array.from({ length: rows }).map((_, i) => (
        <div className={s.skelDue} key={i}>
          <span className={`${s.skel} ${s.skelCircle}`} style={{ width: 30, height: 30 }} />
          <div className={s.skelUserText}>
            <span className={`${s.skel} ${s.skelLine}`} style={{ width: '60%' }} />
            <span className={`${s.skel} ${s.skelLine}`} style={{ width: '35%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ExportIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function Kpi({ label, value, bg, color, icon }: { label: string; value: React.ReactNode; bg: string; color: string; icon: string }) {
  return (
    <div className={s.kpiCard}>
      <div className={s.kpiIcon} style={{ background: bg, color }}>
        <KpiIcon name={icon} />
      </div>
      <div>
        <div className={s.kpiLabel}>{label}</div>
        <div className={s.kpiValue}>{value}</div>
      </div>
    </div>
  );
}

function KpiIcon({ name }: { name: string }) {
  const c = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'dollar')
    return (
      <svg {...c}>
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    );
  if (name === 'alert')
    return (
      <svg {...c}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  if (name === 'clock')
    return (
      <svg {...c}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  if (name === 'trend')
    return (
      <svg {...c}>
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    );
  return (
    <svg {...c}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </svg>
  );
}

function MiniStat({ label, value, variant }: { label: string; value: React.ReactNode; variant?: 'pos' | 'neg' }) {
  return (
    <div className={s.miniStat}>
      <div className={s.miniLabel}>{label}</div>
      <div className={`${s.miniValue} ${variant === 'pos' ? s.pos : variant === 'neg' ? s.neg : ''}`}>{value}</div>
    </div>
  );
}

function MrrChart({ mrr, months }: { mrr: number; months: SparkPoint[] }) {
  const first = months[0]?.value || 0;
  const delta = mrr - first;
  const pct = first > 0 ? Math.round((delta / first) * 100) : 0;
  const arrow = delta >= 0 ? '↑' : '↓';
  const deltaText = first === 0 ? 'Sem histórico anterior' : `${arrow} ${pct >= 0 ? '+' : ''}${pct}% nos últimos 6 meses`;

  const w = 340;
  const h = 110;
  const pad = 10;
  const max = Math.max(...months.map((m) => m.value), 1);
  const stepX = (w - pad * 2) / Math.max(months.length - 1, 1);
  const points = months.map((m, i) => {
    const x = pad + stepX * i;
    const y = h - pad - (m.value / max) * (h - pad * 2);
    return [x, y] as [number, number];
  });
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const areaPath =
    points.length > 0
      ? linePath + ` L${points[points.length - 1][0].toFixed(1)},${h} L${points[0][0].toFixed(1)},${h} Z`
      : '';

  return (
    <>
      <div className={s.mrrCurrent}>{fmtBRL(mrr)}</div>
      <div className={s.mrrDelta}>{deltaText}</div>
      <svg className={s.mrrChart} viewBox="0 0 340 110" preserveAspectRatio="none">
        <defs>
          <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F29725" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#F29725" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="30" x2="340" y2="30" stroke="#eef0f4" strokeWidth="1" />
        <line x1="0" y1="60" x2="340" y2="60" stroke="#eef0f4" strokeWidth="1" />
        <line x1="0" y1="90" x2="340" y2="90" stroke="#eef0f4" strokeWidth="1" />
        {areaPath && <path d={areaPath} fill="url(#mrrGrad)" />}
        {linePath && <path d={linePath} fill="none" stroke="#F29725" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {points.map(([x, y], i) => (
          <circle
            key={i}
            cx={x.toFixed(1)}
            cy={y.toFixed(1)}
            r={i === points.length - 1 ? 4 : 3}
            fill="#F29725"
            stroke={i === points.length - 1 ? '#fff' : undefined}
            strokeWidth={i === points.length - 1 ? 2 : undefined}
          />
        ))}
      </svg>
      <div className={s.mrrLabels}>
        {months.map((m, i) => (
          <span key={i}>{m.label}</span>
        ))}
      </div>
    </>
  );
}

function nextBillingCell(sub: SubscriptionRow): React.ReactNode {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const billing = sub.next_billing_date ? new Date(sub.next_billing_date) : null;
  const isOverdue = sub.status === 'overdue';

  if (billing) {
    const diff = Math.ceil((billing.getTime() - today.getTime()) / 86400000);
    const date = fmtDate(sub.next_billing_date);
    if (isOverdue || diff < 0) {
      const daysLate = Math.abs(diff);
      return (
        <>
          <span className={s.dueRed}>Em atraso</span>
          <div className={s.amountSub}>
            {daysLate}d · {date}
          </div>
        </>
      );
    }
    if (diff === 0)
      return (
        <>
          <span className={s.dueRed}>Hoje</span>
          <div className={s.amountSub}>{date}</div>
        </>
      );
    if (diff <= 5)
      return (
        <>
          <span className={s.dueWarn}>Em {diff}d</span>
          <div className={s.amountSub}>{date}</div>
        </>
      );
    return (
      <>
        <span style={{ fontWeight: 600 }}>{date}</span>
        <div className={s.amountSub}>Em {diff} dias</div>
      </>
    );
  }
  if (isOverdue) return <span className={s.dueRed}>Em atraso</span>;
  return <span style={{ color: 'var(--muted)' }}>—</span>;
}

function SubRow({ sub, onEdit, onDelete }: { sub: SubscriptionRow; onEdit: () => void; onDelete: () => void }) {
  const svcsText =
    [...new Set((sub.active_services || []).map((sv) => canonicalSector(sv.service_type)).filter(Boolean))].join(', ') ||
    sub.plan_name ||
    '—';
  const pm = pmIconLabel(sub.payment_method);
  const b = statusBadge(sub.status);
  return (
    <tr className={sub.status === 'overdue' ? s.rowOverdue : ''}>
      <td>
        <div className={s.userCell}>
          <div className={s.avatar}>{initials(sub.client_name)}</div>
          <div>
            <div className={s.userName}>{sub.client_name}</div>
            <div className={s.userPlan}>{svcsText}</div>
          </div>
        </div>
      </td>
      <td>
        <div className={s.amount}>{fmtBRL(sub.monthly_value)}</div>
        <div className={s.amountSub}>mensal</div>
      </td>
      <td>{nextBillingCell(sub)}</td>
      <td>
        <div className={s.paymentMethod}>
          <span className={`${s.pmIcon} ${pm.cls}`}>{pm.label}</span>
          <span>{pmText(sub)}</span>
        </div>
      </td>
      <td>
        <span className={`${s.badge} ${b.cls}`}>{b.txt}</span>
      </td>
      <td style={{ textAlign: 'right' }}>
        <div className={s.rowActions}>
          <button className={s.iconBtn} title="Editar" onClick={onEdit}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
          <button className={s.iconBtn} title="Excluir" onClick={onDelete}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

function RenewalsList({ renewals }: { renewals: ServiceRenewal[] | null }) {
  if (renewals == null) return <ListSkeleton rows={4} />;
  if (renewals.length === 0)
    return (
      <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: '0.84rem' }}>
        Nenhum serviço ativo com renovação próxima.
      </div>
    );
  return (
    <>
      {renewals.map((r, i) => {
        const dl = Number.isFinite(r.days_left as number) ? (r.days_left as number) : null;
        let whenCls = s.dueWhen;
        let whenTxt: string;
        if (dl == null) whenTxt = '—';
        else if (dl < 0) {
          whenCls = `${s.dueWhen} ${s.danger}`;
          whenTxt = `Atraso ${Math.abs(dl)}d`;
        } else if (dl === 0) {
          whenCls = `${s.dueWhen} ${s.danger}`;
          whenTxt = 'Hoje';
        } else if (dl <= 5) {
          whenCls = `${s.dueWhen} ${s.warn}`;
          whenTxt = `${dl}d`;
        } else {
          whenTxt = `${dl}d`;
        }
        const dateStr = r.access_until ? fmtDate(r.access_until) : '—';
        const value =
          r.monthly_value != null
            ? `R$ ${Number(r.monthly_value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : '—';
        return (
          <div className={s.dueItem} key={i}>
            <div className={s.avatar}>{initials(r.client_display_name || r.client_slug)}</div>
            <div>
              <div className={s.dueName}>{r.client_display_name || r.client_slug}</div>
              <div className={s.dueWhen}>
                {r.service_type || ''} · {dateStr}
              </div>
            </div>
            <div className={s.dueAmount}>
              {value}
              <span className={s.dueAmountWhen}>
                <span className={whenCls}>{whenTxt}</span>
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

function purchaseStatusStyle(status: string): { bg: string; color: string; txt: string } {
  const map: Record<string, { bg: string; color: string; txt: string }> = {
    approved: { bg: '#dcfce7', color: '#15803d', txt: 'Aprovado' },
    complete: { bg: '#dcfce7', color: '#15803d', txt: 'Completo' },
    canceled: { bg: '#f1f5f9', color: '#64748b', txt: 'Cancelado' },
    refunded: { bg: '#fef3c7', color: '#92400e', txt: 'Reembolsado' },
    chargeback: { bg: '#fee2e2', color: '#b91c1c', txt: 'Chargeback' },
  };
  return map[status] || { bg: '#f1f5f9', color: '#64748b', txt: status };
}

function pmLabel(type?: string | null): { icon: string; label: string } {
  const map: Record<string, { icon: string; label: string }> = {
    CREDIT_CARD: { icon: '💳', label: 'Cartão de crédito' },
    BILLET: { icon: '📄', label: 'Boleto' },
    PIX: { icon: '⚡', label: 'PIX' },
    PAYPAL: { icon: '🅿', label: 'PayPal' },
  };
  return map[type ?? ''] || { icon: '💰', label: type || '—' };
}

function HistList({ loading, data }: { loading: boolean; data: PurchaseRow[] }) {
  if (loading) return <ListSkeleton rows={4} />;
  if (data.length === 0) return <div className={s.placeholder}>Nenhuma cobrança encontrada.</div>;
  return (
    <>
      {data.map((p, i) => {
        const pm = pmLabel(p.payment_type);
        const setor = canonicalSector(p.service_name || '');
        const date = fmtDate(p.charged_at);
        const st = purchaseStatusStyle(p.status);
        const inst = (p.installments_total ?? 0) > 1 ? `${p.installment_number || 1}/${p.installments_total}x` : '';
        return (
          <div className={s.histItem} key={p.transaction_code + i}>
            <div className={s.histIcon}>{pm.icon}</div>
            <div className={s.histBody}>
              <div className={s.histRow}>
                <span className={s.histEmail}>{p.buyer_email}</span>
                <span className={s.purchaseStatus} style={{ background: st.bg, color: st.color }}>
                  {st.txt}
                </span>
              </div>
              <div className={s.histRow} style={{ marginTop: 3 }}>
                <span className={s.histMeta}>{pm.label}</span>
                <span className={s.histSep}>·</span>
                <span className={s.histSetor}>{setor}</span>
                {inst && <span className={s.histInst}>{inst}</span>}
              </div>
              <div className={s.histDate}>
                {date} · {p.transaction_code}
              </div>
            </div>
            <div className={s.histAmount}>{fmtBRL(p.amount)}</div>
          </div>
        );
      })}
    </>
  );
}

// ── Modal nova/editar assinatura ──
function SubModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: SubscriptionRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientSlug, setClientSlug] = useState('');
  const [plan, setPlan] = useState(editing?.plan_name || 'Diamante');
  const [value, setValue] = useState(editing ? Number(editing.monthly_value || 0).toFixed(2) : '0.00');
  const [next, setNext] = useState(editing?.next_billing_date || '');
  const [statusVal, setStatusVal] = useState(editing?.status || 'paid');
  const [payMethod, setPayMethod] = useState(editing?.payment_method || 'pix');
  const [payLabel, setPayLabel] = useState(editing?.payment_method_label || '');
  const [notes, setNotes] = useState(editing?.notes || '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) return;
    (async () => {
      try {
        setClients(await listClientsForSubscription());
      } catch (e) {
        console.error(e);
      }
    })();
  }, [editing]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload: SubscriptionPayload = {
        plan_name: plan.trim(),
        monthly_value: Number(value) || 0,
        next_billing_date: next || null,
        status: statusVal,
        payment_method: payMethod,
        payment_method_label: payLabel.trim() || null,
        notes: notes.trim() || null,
      };
      if (editing) {
        await updateSubscription(editing.id, payload);
        toast('Assinatura atualizada.');
      } else {
        if (!clientSlug) throw new Error('Selecione o aluno.');
        await createSubscription({ ...payload, client_slug: clientSlug });
        toast('Assinatura criada.');
      }
      onSaved();
    } catch (ex) {
      setError((ex as Error).message || String(ex));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={s.modalOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modalCard}>
        <div className={s.modalHead}>
          <h3>{editing ? `Editar assinatura — ${editing.client_name}` : 'Nova assinatura'}</h3>
          <button type="button" className={s.modalClose} onClick={onClose}>
            ×
          </button>
        </div>
        <form className={s.modalBody} onSubmit={onSubmit}>
          <div className={s.formGroup}>
            {!editing && (
              <div>
                <label className={s.label}>Aluno</label>
                <select className={s.modalInput} required value={clientSlug} onChange={(e) => setClientSlug(e.target.value)}>
                  {clients.length === 0 ? (
                    <option value="">Todos os alunos já têm assinatura</option>
                  ) : (
                    <>
                      <option value="">— selecione —</option>
                      {clients.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {c.display_name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <small className={s.hint}>Só alunos sem assinatura aparecem aqui.</small>
              </div>
            )}
            <div className={s.grid2}>
              <div>
                <label className={s.label}>Plano</label>
                <input className={s.modalInput} type="text" required value={plan} onChange={(e) => setPlan(e.target.value)} />
              </div>
              <div>
                <label className={s.label}>Valor mensal (R$)</label>
                <input
                  className={s.modalInput}
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
            </div>
            <div className={s.grid2}>
              <div>
                <label className={s.label}>Próxima cobrança</label>
                <input className={s.modalInput} type="date" value={next} onChange={(e) => setNext(e.target.value)} />
              </div>
              <div>
                <label className={s.label}>Status</label>
                <select className={s.modalInput} value={statusVal} onChange={(e) => setStatusVal(e.target.value)}>
                  <option value="paid">Em dia</option>
                  <option value="overdue">Em atraso</option>
                  <option value="pending">Pendente</option>
                  <option value="canceled">Cancelado</option>
                </select>
              </div>
            </div>
            <div className={s.grid12}>
              <div>
                <label className={s.label}>Forma de pagamento</label>
                <select className={s.modalInput} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="pix">PIX</option>
                  <option value="cc">Cartão</option>
                  <option value="boleto">Boleto</option>
                  <option value="transfer">Transferência</option>
                  <option value="other">Outro</option>
                </select>
              </div>
              <div>
                <label className={s.label}>Detalhes (opcional)</label>
                <input
                  className={s.modalInput}
                  type="text"
                  placeholder="Ex: Cartão **** 4823"
                  value={payLabel}
                  onChange={(e) => setPayLabel(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={s.label}>Notas</label>
              <input className={s.modalInput} type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          {error && <div className={s.formError}>{error}</div>}
          <div className={s.modalFoot}>
            <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
