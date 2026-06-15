'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import s from './admin.module.css';
import {
  listEmployees,
  listOperatorsAdmin,
  listPositions,
  getEmployeeStats,
  setEmployeeStatus,
  deleteEmployee,
  setOperatorStatus,
  deleteOperator,
  exportEmployeesCsv,
  exportOperatorsCsv,
  downloadBlob,
  type EmployeeRow,
  type OperatorRow,
  type Position,
  type EmployeeStats,
} from '@/lib/api/admin';
import { initials, fmtDateTime } from '@/lib/format';
import { toast } from '@/lib/toast';
import Pagination from './Pagination';
import { Stars, StatusCell, OpStatusCell, PositionPill } from './cells';
import EmployeeModal from './EmployeeModal';
import OperatorModal from './OperatorModal';
import {
  IconSearch,
  IconEdit,
  IconCheck,
  IconBan,
  IconTrash,
  IconPlus,
  IconDownload,
  IconUsers,
  IconGem,
  IconChat,
  IconStar,
  IconClock,
} from './icons';

type Tab = 'admins' | 'operators';

export default function EquipeClient() {
  const [tab, setTab] = useState<Tab>('admins');
  const [stats, setStats] = useState<EmployeeStats | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);

  // ── Admins state ──
  const [admins, setAdmins] = useState<EmployeeRow[]>([]);
  const [aCount, setACount] = useState(0);
  const [aPage, setAPage] = useState(1);
  const [aSize, setASize] = useState(25);
  const [aSearch, setASearch] = useState('');
  const [aStatus, setAStatus] = useState('all');
  const [aLoading, setALoading] = useState(true);
  const [aError, setAError] = useState('');

  // ── Operators state ──
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [oCount, setOCount] = useState(0);
  const [oPage, setOPage] = useState(1);
  const [oSize, setOSize] = useState(25);
  const [oSearch, setOSearch] = useState('');
  const [oStatus, setOStatus] = useState('all');
  const [oLoading, setOLoading] = useState(true);
  const [oError, setOError] = useState('');
  const [oLoaded, setOLoaded] = useState(false);

  // ── Modals ──
  const [empModal, setEmpModal] = useState<{ open: boolean; editing: EmployeeRow | null }>({ open: false, editing: null });
  const [opModal, setOpModal] = useState<{ open: boolean; editing: OperatorRow | null }>({ open: false, editing: null });

  const aSearchInput = useRef('');
  const oSearchInput = useRef('');
  const aDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const oDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setStats(await getEmployeeStats());
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadAdmins = useCallback(async () => {
    setALoading(true);
    setAError('');
    try {
      const { data, count } = await listEmployees({
        search: aSearch,
        status: aStatus,
        role: 'admin',
        limit: aSize,
        offset: (aPage - 1) * aSize,
      });
      setAdmins(data);
      setACount(count);
    } catch (e: unknown) {
      setAError(e instanceof Error ? e.message : String(e));
    } finally {
      setALoading(false);
    }
  }, [aSearch, aStatus, aSize, aPage]);

  const loadOperators = useCallback(async () => {
    setOLoading(true);
    setOError('');
    try {
      const { data, count } = await listOperatorsAdmin({
        search: oSearch,
        status: oStatus,
        limit: oSize,
        offset: (oPage - 1) * oSize,
      });
      setOperators(data);
      setOCount(count);
      setOLoaded(true);
    } catch (e: unknown) {
      setOError(e instanceof Error ? e.message : String(e));
    } finally {
      setOLoading(false);
    }
  }, [oSearch, oStatus, oSize, oPage]);

  useEffect(() => {
    loadStats();
    listPositions().then(setPositions).catch(console.error);
  }, [loadStats]);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  // carrega operadores só quando a aba é aberta a primeira vez, depois reage a filtros
  useEffect(() => {
    if (tab === 'operators') loadOperators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, oSearch, oStatus, oSize, oPage]);

  // ── handlers admins ──
  function onASearch(v: string) {
    aSearchInput.current = v;
    if (aDebounce.current) clearTimeout(aDebounce.current);
    aDebounce.current = setTimeout(() => {
      setAPage(1);
      setASearch(aSearchInput.current);
    }, 280);
  }

  async function toggleAdmin(u: EmployeeRow) {
    let next: string, action: string, successMsg: string;
    if (u.status === 'pending') {
      next = 'approved';
      action = 'aprovar';
      successMsg = 'Acesso liberado.';
    } else if (u.status === 'disabled') {
      next = 'approved';
      action = 'reativar';
      successMsg = 'Funcionário reativado.';
    } else {
      next = 'disabled';
      action = 'desabilitar';
      successMsg = 'Funcionário desabilitado.';
    }
    if (!confirm(`Tem certeza que deseja ${action} ${u.name}?`)) return;
    try {
      await setEmployeeStatus(u.id, next);
      toast(successMsg);
      await Promise.all([loadAdmins(), loadStats()]);
    } catch (e: unknown) {
      toast('Erro: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  }

  async function removeAdmin(u: EmployeeRow) {
    const txt = prompt(
      `ATENÇÃO: isso vai excluir DEFINITIVAMENTE o acesso de ${u.name} (${u.email}).\n` +
        `Esta ação não pode ser desfeita.\n\n` +
        `Para confirmar, digite EXCLUIR (em maiúsculas):`,
    );
    if (txt !== 'EXCLUIR') {
      if (txt !== null) toast('Texto incorreto. Exclusão cancelada.', 'warning');
      return;
    }
    try {
      await deleteEmployee(u.id);
      toast(`${u.name} foi excluído.`);
      await Promise.all([loadAdmins(), loadStats()]);
    } catch (e: unknown) {
      toast('Erro ao excluir: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  }

  // ── handlers operadores ──
  function onOSearch(v: string) {
    oSearchInput.current = v;
    if (oDebounce.current) clearTimeout(oDebounce.current);
    oDebounce.current = setTimeout(() => {
      setOPage(1);
      setOSearch(oSearchInput.current);
    }, 280);
  }

  async function toggleOp(o: OperatorRow) {
    const next = o.status === 'inactive' ? 'active' : 'inactive';
    const action = next === 'active' ? 'ativar' : 'inativar';
    if (!confirm(`Tem certeza que deseja ${action} ${o.name}?`)) return;
    try {
      await setOperatorStatus(o.id, next);
      toast(next === 'active' ? 'Operador ativado.' : 'Operador inativado.');
      await Promise.all([loadOperators(), loadStats()]);
    } catch (e: unknown) {
      toast('Erro: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  }

  async function removeOp(o: OperatorRow) {
    const txt = prompt(`ATENÇÃO: isso vai excluir DEFINITIVAMENTE o operador ${o.name}.\nPara confirmar, digite EXCLUIR:`);
    if (txt !== 'EXCLUIR') {
      if (txt !== null) toast('Texto incorreto. Exclusão cancelada.', 'warning');
      return;
    }
    try {
      await deleteOperator(o.id);
      toast(`${o.name} foi excluído.`);
      await Promise.all([loadOperators(), loadStats()]);
    } catch (e: unknown) {
      toast('Erro ao excluir: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  }

  async function doExport() {
    try {
      const ts = new Date().toISOString().slice(0, 10);
      if (tab === 'admins') {
        downloadBlob(await exportEmployeesCsv(), `funcionarios-${ts}.csv`);
      } else {
        downloadBlob(await exportOperatorsCsv(), `operadores-${ts}.csv`);
      }
    } catch (e: unknown) {
      toast('Erro ao exportar: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  }

  return (
    <div className={s.shell}>
      {/* ── Page head ── */}
      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Equipe</h1>
          <p className={s.pageSub}>Gerencie administradores e equipe operacional ClickUp.</p>
        </div>
        <div className={s.pageActions}>
          <button className="btn-secondary" onClick={doExport}>
            <IconDownload width={15} height={15} /> Exportar planilha
          </button>
          {tab === 'admins' ? (
            <button className="btn-primary" onClick={() => setEmpModal({ open: true, editing: null })}>
              <IconPlus width={15} height={15} /> Novo admin
            </button>
          ) : (
            <button className={`btn-primary ${s.btnOp}`} onClick={() => setOpModal({ open: true, editing: null })}>
              <IconPlus width={15} height={15} /> Novo operador
            </button>
          )}
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className={s.kpiGrid}>
        <Kpi icon={<IconUsers />} bg="#eaf2ff" color="#3b82f6" label="Admins / Operadores" value={stats ? `${stats.admins} / ${stats.operators}` : '—'} />
        <Kpi icon={<IconGem />} bg="#f1ecff" color="#8b5cf6" label="Alunos diamantes" value={stats ? String(stats.students) : '—'} />
        <Kpi icon={<IconChat />} bg="#e7f7ee" color="#16a34a" label="Avaliações recebidas" value={stats ? stats.ratings.toLocaleString('pt-BR') : '—'} />
        <Kpi icon={<IconStar />} bg="#fff4d6" color="#eab308" label="Média geral" value={stats ? stats.ratingAvg.toFixed(2).replace('.', ',') : '—'} />
        <Kpi icon={<IconClock />} bg="#ffe9ee" color="#ec4899" label="Admins ativos hoje" value={stats ? String(stats.activeToday) : '—'} />
      </div>

      {/* ── Tabs ── */}
      <div className={s.tabs}>
        <button className={`${s.tabBtn} ${tab === 'admins' ? s.active : ''}`} onClick={() => setTab('admins')}>
          Administradores
          {stats && <span className={s.tabCount}>{stats.admins}</span>}
        </button>
        <button className={`${s.tabBtn} ${tab === 'operators' ? s.active : ''}`} onClick={() => setTab('operators')}>
          Equipe Operacional
          {stats && <span className={s.tabCount}>{stats.operators}</span>}
        </button>
      </div>

      {/* ── Painel Admins ── */}
      {tab === 'admins' && (
        <div className={s.tableCard}>
          <div className={s.tableHeadBar}>
            <div className={s.tableHeadTitle}>
              <h2>Administradores</h2>
              <p>Usuários com acesso ao painel admin.</p>
            </div>
            <div className={s.tableControls}>
              <div className={s.searchWrap}>
                <IconSearch />
                <input className={s.searchInput} type="text" placeholder="Buscar por nome ou email" defaultValue={aSearch} onChange={(e) => onASearch(e.target.value)} />
              </div>
              <select
                className={s.selectInput}
                value={aStatus}
                onChange={(e) => {
                  setAPage(1);
                  setAStatus(e.target.value);
                }}
              >
                <option value="all">Status: Todos</option>
                <option value="approved">Ativos</option>
                <option value="pending">Pendentes</option>
                <option value="disabled">Desabilitados</option>
                <option value="rejected">Rejeitados</option>
              </select>
            </div>
          </div>

          <div className={s.tableWrap}>
            <table className={s.usersTable}>
              <thead>
                <tr>
                  <th>Administrador</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Último login</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {aLoading ? (
                  <SkeletonRows cols={5} withUser />
                ) : aError ? (
                  <tr>
                    <td colSpan={5} className={s.errCell}>
                      Erro ao carregar: {aError}
                    </td>
                  </tr>
                ) : admins.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={s.emptyCell}>
                      Nenhum administrador encontrado.
                    </td>
                  </tr>
                ) : (
                  admins.map((u) => (
                    <tr key={u.id}>
                      <td className={s.cardHeader}>
                        <div className={s.userCell}>
                          <div className={s.avatar}>{initials(u.name)}</div>
                          <div className={s.userCellInfo}>
                            <span className={s.userCellName}>{u.name || '—'}</span>
                            <span className={s.userCellId}>Admin</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Email">
                        <span className={s.subtle}>{u.email || '—'}</span>
                      </td>
                      <td data-label="Status">
                        <StatusCell status={u.status} />
                      </td>
                      <td data-label="Último login">
                        <span className={s.subtle} style={{ fontSize: '0.82rem' }}>
                          {u.last_login_at ? fmtDateTime(u.last_login_at) : 'Nunca acessou'}
                        </span>
                      </td>
                      <td className={s.cardActions} data-label="Ações">
                        <div className={s.rowActions}>
                          <button className={s.iconBtn} title="Editar" onClick={() => setEmpModal({ open: true, editing: u })}>
                            <IconEdit />
                          </button>
                          <button
                            className={`${s.iconBtn} ${u.status === 'pending' ? s.success : ''}`}
                            title={u.status === 'disabled' ? 'Reativar' : u.status === 'pending' ? 'Aprovar acesso' : 'Desabilitar'}
                            onClick={() => toggleAdmin(u)}
                          >
                            {u.status === 'disabled' || u.status === 'pending' ? <IconCheck /> : <IconBan />}
                          </button>
                          <button className={`${s.iconBtn} ${s.danger}`} title="Excluir acesso" onClick={() => removeAdmin(u)}>
                            <IconTrash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination page={aPage} pageSize={aSize} total={aCount} noun="funcionários" onPage={setAPage} onPageSize={(n) => { setASize(n); setAPage(1); }} />
        </div>
      )}

      {/* ── Painel Operadores ── */}
      {tab === 'operators' && (
        <div className={s.tableCard}>
          <div className={s.tableHeadBar}>
            <div className={s.tableHeadTitle}>
              <h2>Equipe Operacional</h2>
              <p>Operadores que atuam via ClickUp. Sem acesso autenticado ao portal.</p>
            </div>
            <div className={s.tableControls}>
              <div className={s.searchWrap}>
                <IconSearch />
                <input className={s.searchInput} type="text" placeholder="Buscar por nome ou email" defaultValue={oSearch} onChange={(e) => onOSearch(e.target.value)} />
              </div>
              <select
                className={s.selectInput}
                value={oStatus}
                onChange={(e) => {
                  setOPage(1);
                  setOStatus(e.target.value);
                }}
              >
                <option value="all">Status: Todos</option>
                <option value="active">Ativos</option>
                <option value="inactive">Inativos</option>
                <option value="suspended">Suspensos</option>
              </select>
            </div>
          </div>

          <div className={s.tableWrap}>
            <table className={s.usersTable}>
              <thead>
                <tr>
                  <th>Operador</th>
                  <th>Email</th>
                  <th>Cargo</th>
                  <th>ClickUp ID</th>
                  <th>Avaliação</th>
                  <th style={{ textAlign: 'center' }}>Alunos</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {oLoading && !oLoaded ? (
                  <SkeletonRows cols={8} withUser />
                ) : oError ? (
                  <tr>
                    <td colSpan={8} className={s.errCell}>
                      Erro ao carregar: {oError}
                    </td>
                  </tr>
                ) : operators.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={s.emptyCell}>
                      Nenhum operador encontrado.
                    </td>
                  </tr>
                ) : (
                  operators.map((o) => (
                    <tr key={o.id}>
                      <td className={s.cardHeader}>
                        <div className={s.userCell}>
                          <div className={s.avatar}>{initials(o.name)}</div>
                          <div className={s.userCellInfo}>
                            <span className={s.userCellName}>{o.name || '—'}</span>
                            <span className={s.userCellId}>ClickUp only</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Email">
                        <span className={s.subtle}>{o.email || '—'}</span>
                      </td>
                      <td data-label="Cargo">
                        <PositionPill name={o.position_name} color={o.position_color} />
                      </td>
                      <td data-label="ClickUp ID">
                        <code className={s.mono}>{o.clickup_user_id || '—'}</code>
                      </td>
                      <td data-label="Avaliação">
                        <Stars rating={o.rating_avg} />
                      </td>
                      <td data-label="Alunos" style={{ textAlign: 'center' }}>
                        <span className={`${s.countPill} ${(o.students_count ?? 0) === 0 ? s.zero : ''}`}>{o.students_count ?? 0}</span>
                      </td>
                      <td data-label="Status">
                        <OpStatusCell status={o.status} />
                      </td>
                      <td className={s.cardActions} data-label="Ações">
                        <div className={s.rowActions}>
                          <button className={s.iconBtn} title="Editar" onClick={() => setOpModal({ open: true, editing: o })}>
                            <IconEdit />
                          </button>
                          <button
                            className={`${s.iconBtn} ${o.status === 'inactive' ? '' : s.danger}`}
                            title={o.status === 'inactive' ? 'Ativar' : 'Inativar'}
                            onClick={() => toggleOp(o)}
                          >
                            {o.status === 'inactive' ? <IconCheck /> : <IconBan />}
                          </button>
                          <button className={`${s.iconBtn} ${s.danger}`} title="Excluir operador" onClick={() => removeOp(o)}>
                            <IconTrash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination page={oPage} pageSize={oSize} total={oCount} noun="operadores" onPage={setOPage} onPageSize={(n) => { setOSize(n); setOPage(1); }} />
        </div>
      )}

      <EmployeeModal
        open={empModal.open}
        editing={empModal.editing}
        onClose={() => setEmpModal({ open: false, editing: null })}
        onSaved={() => {
          loadAdmins();
          loadStats();
        }}
      />
      <OperatorModal
        open={opModal.open}
        editing={opModal.editing}
        positions={positions}
        onClose={() => setOpModal({ open: false, editing: null })}
        onSaved={() => {
          loadOperators();
          loadStats();
        }}
      />
    </div>
  );
}

function SkeletonRows({ cols, withUser }: { cols: number; withUser?: boolean }) {
  const widths = ['70%', '55%', '40%', '60%', '45%', '50%', '38%', '52%'];
  return (
    <>
      {Array.from({ length: 6 }).map((_, r) => (
        <tr key={r} className={s.skelRow}>
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c}>
              {withUser && c === 0 ? (
                <div className={s.skelUser}>
                  <span className={s.skelAvatar} />
                  <span className={s.skelBlock} style={{ width: 120 }} />
                </div>
              ) : (
                <span className={s.skelBlock} style={{ width: widths[c % widths.length] }} />
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function Kpi({ icon, bg, color, label, value }: { icon: React.ReactNode; bg: string; color: string; label: string; value: string }) {
  return (
    <div className={s.kpiCard}>
      <div className={s.kpiIcon} style={{ background: bg, color }}>
        {icon}
      </div>
      <div className={s.kpiInfo}>
        <div className={s.kpiLabel}>{label}</div>
        <div className={s.kpiValue}>{value}</div>
      </div>
    </div>
  );
}
