'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { toast } from '@/lib/toast';
import { initials, fmtBRL, fmtDate, canonicalSector } from '@/lib/format';
import {
  listSubscriptions,
  getSubscriptionStats,
  getSubscriptionMoneySummary,
  getMrrSparkline,
  getServicesByType,
  getPurchaseMonthlyStats,
  getServiceRenewals,
  listUnlinkedPurchases,
  listAllClientOptions,
  linkHotmartPurchase,
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
  type UnlinkedPurchase,
} from '@/lib/api/admin-assinaturas';
import FinanceClientModal from './FinanceClientModal';
import ExpandModal from '@/components/ui/ExpandModal';
import CountUp from '@/components/ui/CountUp';
import AnimatedBar from '@/components/ui/AnimatedBar';
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
  const [summary, setSummary] = useState<{ late: number; onTime: number; avg: number; clientsOverdue: number } | null>(
    null,
  );
  const [spark, setSpark] = useState<SparkPoint[]>([]);
  const [servicesByType, setServicesByType] = useState<ServiceByType[]>([]);
  const [monthly, setMonthly] = useState<MonthlyStat[]>([]);
  const [renewals, setRenewals] = useState<ServiceRenewal[] | null>(null);
  const [unlinked, setUnlinked] = useState<UnlinkedPurchase[]>([]);
  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [linkTarget, setLinkTarget] = useState<UnlinkedPurchase | null>(null);

  // Histórico Hotmart
  const [histData, setHistData] = useState<PurchaseRow[]>([]);
  const [histCount, setHistCount] = useState(0);
  const [histPage, setHistPage] = useState(1);
  const [histMonth, setHistMonth] = useState('');
  const [histClient, setHistClient] = useState('');
  const [histLoading, setHistLoading] = useState(true);
  const [histClients, setHistClients] = useState<{ slug: string; name: string }[]>([]);

  const [modal, setModal] = useState<null | { editing: SubscriptionRow | null }>(null);
  const [financeClient, setFinanceClient] = useState<null | { slug: string; name: string }>(null);
  // Modais "expandir" (detalhes em tela cheia) do histórico e dos vencimentos.
  const [expand, setExpand] = useState<null | 'renewals' | 'history'>(null);
  const [histAll, setHistAll] = useState<PurchaseRow[] | null>(null);

  const openHistoryExpand = useCallback(async () => {
    setExpand('history');
    setHistAll(null);
    try {
      const { data } = await listPurchasesHistory({ limit: 300, offset: 0, month: histMonth, clientSlug: histClient });
      setHistAll(data);
    } catch {
      setHistAll([]);
    }
  }, [histMonth, histClient]);

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

      const [money, sp, svc, mo] = await Promise.all([
        getSubscriptionMoneySummary(),
        getMrrSparkline(),
        getServicesByType(),
        getPurchaseMonthlyStats(),
      ]);
      setSummary(money);
      setSpark(sp);
      setServicesByType(svc);
      setMonthly(mo);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadRenewals = useCallback(async () => {
    try {
      const [rnw, unl, cli] = await Promise.all([
        getServiceRenewals(),
        listUnlinkedPurchases().catch(() => []),
        listAllClientOptions().catch(() => []),
      ]);
      setRenewals(rnw);
      setUnlinked(unl);
      setAllClients(cli);
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

      {/* KPIs — faixa de largura total */}
      <div className={s.kpiGrid}>
        <Kpi label="Receita" value={stats ? <CountUp value={stats.mrr} format={fmtBRL} /> : '—'} bg="#eaf2ff" color="#3b82f6" icon="dollar" />
        <Kpi label="Assinantes ativos" value={stats ? <CountUp value={stats.active} /> : '—'} bg="#f1ecff" color="#8b5cf6" icon="users" />
        <Kpi label="Inadimplentes" value={summary ? <CountUp value={summary.clientsOverdue} /> : '—'} bg="#fee2e2" color="#ef4444" icon="alert" />
        <Kpi label="Em atraso" value={summary ? <CountUp value={summary.late} format={fmtBRL} /> : '—'} bg="#fff4d6" color="#eab308" icon="clock" />
        <Kpi label="Retenção (não cancelados)" value={stats ? <CountUp value={stats.retention} format={(n) => Math.round(n) + '%'} /> : '—'} bg="#e7f7ee" color="#16a34a" icon="trend" />
      </div>

      {/* Coluna 1: tabela */}
      <div className={s.col}>
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
                    <SubRow
                      key={sub.id}
                      sub={sub}
                      onEdit={() => setModal({ editing: sub })}
                      onDelete={() => onDelete(sub)}
                      onFinance={() => setFinanceClient({ slug: sub.client_slug, name: sub.client_name })}
                    />
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
            <MiniStat label="Em dia" value={summary ? fmtBRL(summary.onTime) : '—'} variant="pos" />
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
                  <AnimatedBar
                    pct={pct}
                    delay={0.04 * Math.min(servicesByType.indexOf(svc), 8)}
                    trackClassName={s.serviceBar}
                    fillClassName={`${s.serviceBarFill} ${(s as Record<string, string>)[color]}`}
                  />
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
                  <AnimatedBar pct={pct} trackClassName={s.serviceBar} fillClassName={`${s.serviceBarFill} ${s.orange}`} />
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className={s.meta}>{renewals == null ? '—' : renewals.length === 0 ? 'Nenhum' : `${renewals.length} próximos`}</span>
              {renewals && renewals.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpand('renewals')}
                  style={{ border: '1px solid var(--border)', background: 'none', borderRadius: 8, padding: '4px 10px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', color: 'var(--accent-strong)', whiteSpace: 'nowrap' }}
                >
                  Expandir ↗
                </button>
              )}
            </div>
          </div>
          <div className={s.scrollBox}>
            <RenewalsList renewals={renewals} />
          </div>
        </div>

        {unlinked.length > 0 && (
          <div
            className={s.panelCard}
            style={{ border: '1px solid #f5c2c0', background: '#fff6f5' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <h3 className={s.panelTitle} style={{ margin: 0, color: '#b42318' }}>
                ⚠ {unlinked.length} compra{unlinked.length > 1 ? 's' : ''} sem aluno vinculado
              </h3>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '0.82rem', color: 'var(--muted)' }}>
              Pagamentos Hotmart aprovados cujo e-mail não casou com nenhum aluno — o serviço{' '}
              <strong>não foi renovado automaticamente</strong>. Identifique o aluno e renove pelo
              Financeiro manual (registrar pagamento / estender acesso).
            </p>
            <div className={s.scrollBox}>
              {unlinked.map((p) => (
                <div className={s.histItem} key={p.transaction_code}>
                  <div className={s.histIcon}>⚠</div>
                  <div className={s.histBody}>
                    <div className={s.histRow}>
                      <span className={s.histEmail}>{p.buyer_email}</span>
                    </div>
                    <div className={s.histRow} style={{ marginTop: 3 }}>
                      <span className={s.histSetor}>
                        {canonicalSector(p.service_name || '') || p.offer_code || '—'}
                      </span>
                    </div>
                    <div className={s.histDate}>{p.charged_at ? fmtDate(p.charged_at) : '—'}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <div className={s.histAmount}>{fmtBRL(Number(p.amount || 0))}</div>
                    <button
                      type="button"
                      onClick={() => setLinkTarget(p)}
                      style={{ border: 'none', background: '#b42318', color: '#fff', borderRadius: 8, padding: '5px 12px', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      Vincular a aluno
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
              <button
                type="button"
                onClick={() => void openHistoryExpand()}
                style={{ border: '1px solid var(--border)', background: 'none', borderRadius: 8, padding: '4px 10px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', color: 'var(--accent-strong)', whiteSpace: 'nowrap' }}
              >
                Expandir ↗
              </button>
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
      {financeClient && (
        <FinanceClientModal
          clientSlug={financeClient.slug}
          clientName={financeClient.name}
          onClose={() => setFinanceClient(null)}
          onChanged={() => {
            void Promise.all([load(), loadStats()]);
          }}
        />
      )}
      {linkTarget && (
        <LinkPurchaseModal
          purchase={linkTarget}
          clients={allClients}
          onClose={() => setLinkTarget(null)}
          onDone={async () => {
            setLinkTarget(null);
            await Promise.all([loadRenewals(), loadStats(), loadHist()]);
          }}
        />
      )}
      {expand === 'renewals' && (
        <ExpandModal title="Próximos vencimentos por serviço" onClose={() => setExpand(null)}>
          <RenewalsTable renewals={renewals || []} />
        </ExpandModal>
      )}
      {expand === 'history' && (
        <ExpandModal title="Histórico de cobranças" onClose={() => setExpand(null)}>
          <PurchasesTable data={histAll} />
        </ExpandModal>
      )}
    </div>
  );
}

// ── Tabelas detalhadas usadas dentro do ExpandModal compartilhado ──
const expTh: React.CSSProperties = { textAlign: 'left', padding: '11px 14px', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', background: 'var(--table-head-bg, #faf8fd)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, whiteSpace: 'nowrap' };
const expThRight: React.CSSProperties = { ...expTh, textAlign: 'right' };
const expTd: React.CSSProperties = { padding: '11px 14px', fontSize: '0.85rem', borderTop: '1px solid var(--border)', verticalAlign: 'middle', color: 'var(--text)' };
const expTdRight: React.CSSProperties = { ...expTd, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const expWrap: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' };
const expTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };

function pill(text: string, bg: string, color: string) {
  return (
    <span style={{ display: 'inline-block', background: bg, color, borderRadius: 999, padding: '3px 10px', fontSize: '0.74rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

function expAvatar(name: string) {
  return (
    <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '0.72rem', fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
      {initials(name)}
    </span>
  );
}

function ExpSummary({ left, right }: { left: string; right: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, fontSize: '0.82rem', color: 'var(--muted)' }}>
      <span>{left}</span>
      <span style={{ fontWeight: 700, color: 'var(--text)' }}>{right}</span>
    </div>
  );
}

function RenewalsTable({ renewals }: { renewals: ServiceRenewal[] }) {
  if (renewals.length === 0) return <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>Nenhum vencimento próximo.</p>;
  const total = renewals.reduce((sum, r) => sum + (Number(r.monthly_value) || 0), 0);
  return (
    <>
      <style>{`.expRow{transition:background .12s}.expRow:hover{background:var(--table-row-hover,#faf8fd)}`}</style>
      <ExpSummary left={`${renewals.length} vencimento${renewals.length === 1 ? '' : 's'} próximo${renewals.length === 1 ? '' : 's'}`} right={`Total ${fmtBRL(total)}/mês`} />
      <div style={expWrap}>
        <table style={expTable}>
          <thead>
            <tr>
              <th style={expTh}>Cliente</th>
              <th style={expTh}>Serviço</th>
              <th style={expTh}>Vencimento</th>
              <th style={expTh}>Prazo</th>
              <th style={expThRight}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {renewals.map((r, i) => {
              const dl = Number.isFinite(r.days_left as number) ? (r.days_left as number) : null;
              const p =
                dl == null
                  ? { t: '—', bg: '#f1eef8', c: '#6b6584' }
                  : dl < 0
                    ? { t: `Atraso ${Math.abs(dl)}d`, bg: '#fee2e2', c: '#b42318' }
                    : dl === 0
                      ? { t: 'Hoje', bg: '#fee2e2', c: '#b42318' }
                      : dl <= 5
                        ? { t: `Em ${dl}d`, bg: '#fff4d6', c: '#b45309' }
                        : { t: `Em ${dl}d`, bg: '#e7f7ee', c: '#15803d' };
              return (
                <tr key={i} className="expRow">
                  <td style={expTd}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {expAvatar(r.client_display_name || r.client_slug)}
                      <span style={{ fontWeight: 600 }}>{r.client_display_name || r.client_slug}</span>
                    </span>
                  </td>
                  <td style={{ ...expTd, color: 'var(--muted)' }}>{r.service_type || '—'}</td>
                  <td style={expTd}>{r.access_until ? fmtDate(r.access_until) : '—'}</td>
                  <td style={expTd}>{pill(p.t, p.bg, p.c)}</td>
                  <td style={expTdRight}>{r.monthly_value != null ? fmtBRL(Number(r.monthly_value)) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PurchasesTable({ data }: { data: PurchaseRow[] | null }) {
  if (data == null) return <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>Carregando…</p>;
  if (data.length === 0) return <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>Nenhuma cobrança encontrada.</p>;
  const total = data
    .filter((p) => p.status === 'approved' || p.status === 'complete')
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  return (
    <>
      <style>{`.expRow{transition:background .12s}.expRow:hover{background:var(--table-row-hover,#faf8fd)}`}</style>
      <ExpSummary left={`${data.length} cobrança${data.length === 1 ? '' : 's'}`} right={`Aprovado ${fmtBRL(total)}`} />
      <div style={expWrap}>
        <table style={expTable}>
          <thead>
            <tr>
              <th style={expTh}>Data</th>
              <th style={expTh}>Comprador</th>
              <th style={expTh}>Serviço</th>
              <th style={expThRight}>Valor</th>
              <th style={expTh}>Parcela</th>
              <th style={expTh}>Forma</th>
              <th style={expTh}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p, i) => {
              const st = purchaseStatusStyle(p.status);
              const pm = pmLabel(p.payment_type);
              const inst = (p.installments_total ?? 0) > 1 ? `${p.installment_number || 1}/${p.installments_total}x` : '—';
              return (
                <tr key={p.transaction_code + i} className="expRow">
                  <td style={{ ...expTd, whiteSpace: 'nowrap' }}>{fmtDate(p.charged_at)}</td>
                  <td style={{ ...expTd, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.buyer_email}>
                    {p.buyer_email}
                  </td>
                  <td style={{ ...expTd, color: 'var(--muted)' }}>{canonicalSector(p.service_name || '') || p.service_name || '—'}</td>
                  <td style={expTdRight}>{fmtBRL(Number(p.amount || 0))}</td>
                  <td style={{ ...expTd, color: 'var(--muted)' }}>{inst}</td>
                  <td style={{ ...expTd, whiteSpace: 'nowrap' }}>
                    {pm.icon} {pm.label}
                  </td>
                  <td style={expTd}>{pill(st.txt, st.bg, st.color)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
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
    <div className={s.kpiCard} style={{ borderTop: `3px solid ${color}` }}>
      <div className={s.kpiHead}>
        <span className={s.kpiLabel}>{label}</span>
        <span className={s.kpiIcon} style={{ background: bg, color }}>
          <KpiIcon name={icon} />
        </span>
      </div>
      <div className={s.kpiValue}>{value}</div>
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

  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const dotsRef = useRef<SVGGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  // GSAP: a linha "desenha" (dashoffset), a área surge e os pontos pulam (stagger).
  useEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const len = line.getTotalLength();
    const ctx = gsap.context(() => {
      gsap.set(line, { strokeDasharray: len, strokeDashoffset: len });
      const tl = gsap.timeline();
      tl.to(line, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.out' });
      if (areaRef.current) tl.fromTo(areaRef.current, { opacity: 0 }, { opacity: 1, duration: 0.6 }, '-=0.5');
      if (dotsRef.current)
        tl.fromTo(
          dotsRef.current.children,
          { scale: 0, transformOrigin: 'center' },
          { scale: 1, duration: 0.4, ease: 'back.out(2)', stagger: 0.07 },
          '-=0.4',
        );
    });
    return () => ctx.revert();
  }, [linePath]);

  function onMove(e: React.MouseEvent) {
    const el = wrapRef.current;
    if (!el || points.length === 0) return;
    const rect = el.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * w;
    let best = 0;
    let bestD = Infinity;
    points.forEach(([px], i) => {
      const d = Math.abs(px - relX);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  }

  const fmtShort = (v: number) => 'R$ ' + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  return (
    <>
      <div className={s.mrrCurrent}>{fmtBRL(mrr)}</div>
      <div className={s.mrrDelta}>{deltaText}</div>
      <div ref={wrapRef} style={{ position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
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
          {areaPath && <path ref={areaRef} d={areaPath} fill="url(#mrrGrad)" />}
          {linePath && (
            <path ref={lineRef} d={linePath} fill="none" stroke="#F29725" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {hover != null && points[hover] && (
            <line
              x1={points[hover][0].toFixed(1)}
              y1="4"
              x2={points[hover][0].toFixed(1)}
              y2={h}
              stroke="#F29725"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.5"
            />
          )}
          <g ref={dotsRef}>
            {points.map(([x, y], i) => (
              <circle
                key={i}
                cx={x.toFixed(1)}
                cy={y.toFixed(1)}
                r={hover === i ? 5 : i === points.length - 1 ? 4 : 3}
                fill="#F29725"
                stroke={hover === i || i === points.length - 1 ? '#fff' : undefined}
                strokeWidth={hover === i || i === points.length - 1 ? 2 : undefined}
              />
            ))}
          </g>
        </svg>
        {hover != null && points[hover] && (
          <div
            style={{
              position: 'absolute',
              left: `${(points[hover][0] / w) * 100}%`,
              top: `${(points[hover][1] / h) * 100}%`,
              transform: 'translate(-50%, calc(-100% - 10px))',
              background: '#1a1430',
              color: '#fff',
              borderRadius: 8,
              padding: '4px 9px',
              fontSize: '0.72rem',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1,
              boxShadow: '0 6px 16px rgba(0,0,0,.22)',
              zIndex: 2,
            }}
          >
            <strong>{fmtShort(months[hover].value)}</strong>
            <span style={{ opacity: 0.7, fontSize: '0.66rem', textTransform: 'capitalize' }}>{months[hover].label}</span>
          </div>
        )}
      </div>
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

function SubRow({ sub, onEdit, onDelete, onFinance }: { sub: SubscriptionRow; onEdit: () => void; onDelete: () => void; onFinance: () => void }) {
  const svcsText =
    [...new Set((sub.active_services || []).map((sv) => canonicalSector(sv.service_type)).filter(Boolean))].join(', ') ||
    sub.plan_name ||
    '—';
  const pm = pmIconLabel(sub.payment_method);
  const b = statusBadge(sub.status);
  return (
    <tr className={sub.status === 'overdue' ? s.rowOverdue : ''}>
      <td className={s.cardHeader}>
        <div className={s.userCell}>
          <div className={s.avatar}>{initials(sub.client_name)}</div>
          <div>
            <div className={s.userName}>{sub.client_name}</div>
            <div className={s.userPlan}>{svcsText}</div>
          </div>
        </div>
      </td>
      <td data-label="Valor mensal">
        <div className={s.amount}>{fmtBRL(sub.monthly_value)}</div>
        <div className={s.amountSub}>mensal</div>
      </td>
      <td data-label="Próxima cobrança">{nextBillingCell(sub)}</td>
      <td data-label="Pagamento">
        <div className={s.paymentMethod}>
          <span className={`${s.pmIcon} ${pm.cls}`}>{pm.label}</span>
          <span>{pmText(sub)}</span>
        </div>
      </td>
      <td data-label="Status">
        <span className={`${s.badge} ${b.cls}`}>{b.txt}</span>
      </td>
      <td className={s.cardActions} data-label="Ação" style={{ textAlign: 'right' }}>
        <div className={s.rowActions}>
          <button className={s.iconBtn} title="Financeiro (pagamentos, adiantamento, acordos)" onClick={onFinance}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </button>
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

// ── Modal: vincular compra Hotmart órfã a um aluno (+ renovar plano) ──
function LinkPurchaseModal({
  purchase,
  clients,
  onClose,
  onDone,
}: {
  purchase: UnlinkedPurchase;
  clients: ClientOption[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [clientSlug, setClientSlug] = useState('');
  const [renew, setRenew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Régua Hotmart: novo acesso = data da compra + 30 dias.
  const newAccess = useMemo(() => {
    if (!purchase.charged_at) return null;
    const d = new Date(purchase.charged_at);
    d.setDate(d.getDate() + 30);
    return d;
  }, [purchase.charged_at]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientSlug) {
      setError('Selecione o aluno.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await linkHotmartPurchase(purchase.transaction_code, clientSlug, renew);
      const name = clients.find((c) => c.slug === clientSlug)?.display_name || clientSlug;
      if (renew && res.services_updated > 0) {
        toast(
          `Compra vinculada a ${name}. ${res.services_updated} serviço(s) renovado(s)${res.new_access_until ? ` até ${fmtDate(res.new_access_until)}` : ''}.`,
        );
      } else if (renew) {
        toast(
          `Compra vinculada a ${name}, mas nenhum serviço ativo foi encontrado para renovar. Use o Financeiro do aluno para estender o acesso.`,
          'warning',
        );
      } else {
        toast(`Compra vinculada a ${name}.`);
      }
      await onDone();
    } catch (ex) {
      setError((ex as Error).message || String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.modalOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modalCard}>
        <div className={s.modalHead}>
          <h3>Vincular compra a um aluno</h3>
          <button type="button" className={s.modalClose} onClick={onClose}>
            ×
          </button>
        </div>
        <form className={s.modalBody} onSubmit={onSubmit}>
          {/* Resumo da compra */}
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 12,
              background: '#faf9fc',
              marginBottom: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <strong style={{ fontSize: '0.92rem', wordBreak: 'break-all' }}>{purchase.buyer_email}</strong>
              <strong style={{ fontSize: '1.05rem', color: '#15803d', whiteSpace: 'nowrap' }}>
                {fmtBRL(Number(purchase.amount || 0))}
              </strong>
            </div>
            <div style={{ marginTop: 4, fontSize: '0.8rem', color: 'var(--muted)' }}>
              {canonicalSector(purchase.service_name || '') || purchase.offer_code || 'Serviço não identificado'}
              {purchase.charged_at ? ` · ${fmtDate(purchase.charged_at)}` : ''}
            </div>
          </div>

          <div className={s.formGroup}>
            <div>
              <label className={s.label}>Qual aluno fez esta compra?</label>
              <select
                className={s.modalInput}
                required
                value={clientSlug}
                onChange={(e) => setClientSlug(e.target.value)}
                autoFocus
              >
                <option value="">— selecione o aluno —</option>
                {clients.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </div>

            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginTop: 4 }}>
              <input type="checkbox" checked={renew} onChange={(e) => setRenew(e.target.checked)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: '0.86rem' }}>
                <strong>Renovar o plano do aluno</strong>
                <br />
                <span style={{ color: 'var(--muted)' }}>
                  Estende o acesso dos serviços ativos
                  {newAccess ? ` até ${newAccess.toLocaleDateString('pt-BR')}` : ''} (data da compra + 30 dias).
                </span>
              </span>
            </label>
          </div>

          {error && <div className={s.formError}>{error}</div>}
          <div className={s.modalFoot}>
            <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy || !clientSlug}>
              {busy ? 'Vinculando…' : renew ? 'Vincular e renovar' : 'Vincular'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
