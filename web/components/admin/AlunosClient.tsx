'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { initials, fmtDate } from '@/lib/format';
import {
  listStudents,
  getStudent,
  getStudentStats,
  getStudentTeam,
  getStudentServices,
  getStudentContractedPositions,
  listOperators,
  assignTeamMember,
  removeTeamMember,
  createStudent,
  updateStudent,
  deleteStudent,
  createClientAccess,
  exportStudentsCsv,
  downloadBlob,
  canonicalServiceName,
  type StudentRow,
  type TeamMember,
  type ServiceRow,
  type OperatorOption,
  type StudentStats,
} from '@/lib/api/admin-alunos';
import s from './alunos.module.css';

// Mapa por setor (saída de canonicalServiceName)
const SERVICE_COLOR_MAP: Record<string, { cls: string; label: string }> = {
  'Gestor de Tráfego': { cls: 'midia', label: 'Tráfego' },
  'Social Media': { cls: 'midia', label: 'Social Media' },
  'Web Designer': { cls: 'design', label: 'Web Designer' },
  Hospedagem: { cls: 'estrategia', label: 'Hospedagem' },
  Designer: { cls: 'design', label: 'Design Gráfico' },
  'Editor de Vídeo': { cls: 'video', label: 'Edição de Vídeo' },
  Automação: { cls: 'estrategia', label: 'Automação' },
  Copywriter: { cls: 'copy', label: 'Copywriter' },
};

function serviceChipMeta(rawType?: string | null) {
  const canonical = canonicalServiceName(rawType);
  return SERVICE_COLOR_MAP[canonical] || { cls: 'estrategia', label: canonical };
}

function billingBadge(status?: string | null): { cls: string; txt: string } {
  const map: Record<string, { cls: string; txt: string }> = {
    paid: { cls: s.badgeGreen, txt: 'Em dia' },
    partial: { cls: s.badgeYellow, txt: 'Parcial' },
    overdue: { cls: s.badgeRed, txt: 'Atrasado' },
    canceled: { cls: s.badgeGray, txt: 'Cancelado' },
    paused: { cls: s.badgeYellow, txt: 'Pausado' },
    trial: { cls: s.badgeBlue, txt: 'Trial' },
    current: { cls: s.badgeGreen, txt: 'Em dia' },
    late: { cls: s.badgeRed, txt: 'Atrasado' },
  };
  return map[status ?? ''] || { cls: s.badgeYellow, txt: status || 'Sem status' };
}

function fmtRating(v?: number | string | null): string {
  return (parseFloat(String(v)) || 0).toFixed(2).replace('.', ',');
}

function StarRow({ rating }: { rating?: number | string | null }) {
  const r = parseFloat(String(rating)) || 0;
  const full = Math.round(r);
  return (
    <span className={s.stars}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 24 24" fill={i <= full ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </span>
  );
}

function nearestDueService(services: ServiceRow[]): ServiceRow | null {
  const candidates = (services || []).filter((sv) => sv.status === 'active' && sv.access_until);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => new Date(a.access_until!).getTime() - new Date(b.access_until!).getTime())[0];
}

const PAGE_SIZES = [10, 25, 50];

export default function AlunosClient() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingTable, setLoadingTable] = useState(true);
  const [tableError, setTableError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [billingStatus, setBillingStatus] = useState('all');

  const [stats, setStats] = useState<StudentStats | null>(null);

  const [operators, setOperators] = useState<OperatorOption[]>([]);

  // Detalhe
  const [current, setCurrent] = useState<StudentRow | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  // Serviços por slug (para badge na linha)
  const [servicesBySlug, setServicesBySlug] = useState<Record<string, ServiceRow[]>>({});

  // Modais
  const [studentModal, setStudentModal] = useState<null | { editingSlug: string | null }>(null);
  const [teamModal, setTeamModal] = useState(false);
  const [creds, setCreds] = useState<null | { name: string; email: string; password: string }>(null);

  // ── Carregamento ──
  const loadStats = useCallback(async () => {
    try {
      setStats(await getStudentStats());
    } catch (e) {
      console.error(e);
    }
  }, []);

  const load = useCallback(async () => {
    setLoadingTable(true);
    setTableError(null);
    try {
      const offset = (page - 1) * pageSize;
      const { data, count } = await listStudents({ search, billingStatus, limit: pageSize, offset });
      setStudents(data);
      setTotal(count);
    } catch (e) {
      setTableError((e as Error).message || String(e));
      console.error(e);
    } finally {
      setLoadingTable(false);
    }
  }, [page, pageSize, search, billingStatus]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    (async () => {
      try {
        setOperators(await listOperators());
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  // Debounce de busca
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearchChange(v: string) {
    setSearchInput(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(v);
      setPage(1);
    }, 280);
  }

  // ── Detalhe ──
  const openDetail = useCallback(async (row: StudentRow) => {
    setCurrent(row);
    setDetailLoading(true);
    setTeam([]);
    setServices([]);
    try {
      const [t, svc] = await Promise.all([getStudentTeam(row.slug), getStudentServices(row.slug)]);
      setTeam(t);
      setServices(svc);
      setServicesBySlug((prev) => ({ ...prev, [row.slug]: svc }));
    } catch (e) {
      console.error(e);
      toast('Erro ao carregar detalhes: ' + ((e as Error).message || e), 'error');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function closeDetail() {
    setCurrent(null);
  }

  const refreshCurrent = useCallback(async () => {
    if (!current) return;
    try {
      const fresh = await getStudent(current.slug);
      if (fresh) await openDetail(fresh);
    } catch (e) {
      console.error(e);
    }
    await Promise.all([load(), loadStats()]);
  }, [current, openDetail, load, loadStats]);

  // ESC fecha detalhe
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDetail();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── Ações ──
  async function onAccessFlow(row: StudentRow) {
    const email = (window.prompt('E-mail de acesso do aluno (login):', row.owner_email || '') || '').trim();
    if (!email) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      alert('E-mail inválido.');
      return;
    }
    const name = row.display_name || row.name || row.slug;
    if (
      !confirm(
        `Criar acesso para "${name}" com o e-mail ${email}?\n\nO sistema gera a senha — você envia manualmente ao aluno.`,
      )
    )
      return;
    try {
      const { email: e, password } = await createClientAccess({ slug: row.slug, email, name: row.display_name || row.name });
      setCreds({ name, email: e, password });
    } catch (err) {
      alert('Erro ao criar acesso: ' + ((err as Error).message || err));
    }
  }

  async function onDelete(row: StudentRow) {
    const ok = prompt(
      `ATENÇÃO: isso vai excluir DEFINITIVAMENTE o aluno "${row.name}" e todos os dados vinculados (equipe, serviços, perfil).\n` +
        `Esta ação não pode ser desfeita.\n\n` +
        `Para confirmar, digite EXCLUIR (em maiúsculas):`,
    );
    if (ok !== 'EXCLUIR') {
      if (ok !== null) toast('Texto incorreto. Exclusão cancelada.', 'warning');
      return;
    }
    try {
      await deleteStudent(row.slug);
      toast(`${row.name} foi excluído.`);
      closeDetail();
      await Promise.all([load(), loadStats()]);
    } catch (e) {
      toast('Erro ao excluir: ' + ((e as Error).message || e), 'error');
    }
  }

  async function onRemoveTeam(assignmentId: string) {
    if (!confirm('Remover este integrante da equipe?')) return;
    try {
      await removeTeamMember(assignmentId);
      toast('Integrante removido.');
      await refreshCurrent();
    } catch (ex) {
      toast('Erro: ' + ((ex as Error).message || ex), 'error');
    }
  }

  async function onExport() {
    try {
      const blob = await exportStudentsCsv();
      downloadBlob(blob, `alunos-diamantes-${new Date().toISOString().slice(0, 10)}.csv`);
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

  // ── Métricas do detalhe ──
  const ratingAvg = parseFloat(String(current?.rating_avg)) || 0;

  return (
    <div className={`${s.wrap} ${current ? s.withDetail : ''}`}>
      <div className={s.head}>
        <div>
          <h1 className={s.title}>Alunos Diamantes</h1>
          <p className={s.subtitle}>Acompanhe os clientes vinculados às suas equipes.</p>
        </div>
        <div className={s.actions}>
          <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onExport}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Exportar planilha
          </button>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setStudentModal({ editingSlug: null })}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Criar aluno
          </button>
        </div>
      </div>

      {/* Coluna 1: KPIs + tabela */}
      <div className={s.col}>
        <div className={s.kpiGrid}>
          <Kpi label="Total de alunos" value={stats?.total} bg="#eaf2ff" color="#3b82f6" icon="users" />
          <Kpi label="Em dia" value={stats?.active} bg="#e7f7ee" color="#16a34a" icon="check" />
          <Kpi label="Com atraso" value={(stats?.overdue ?? 0) + (stats?.partial ?? 0)} bg="#fee2e2" color="#b91c1c" icon="alert" />
          <Kpi label="Com equipe atribuída" value={stats?.withTeam} bg="#f1ecff" color="#8b5cf6" icon="team" />
        </div>

        <div className={s.tableCard}>
          <div className={s.tableHead}>
            <div>
              <h2>Lista de alunos diamantes</h2>
              <p>Clique em um aluno para ver detalhes da equipe e serviços.</p>
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
                  placeholder="Buscar por nome, slug ou email"
                  value={searchInput}
                  onChange={(e) => onSearchChange(e.target.value)}
                />
              </div>
              <select
                className={s.select}
                value={billingStatus}
                onChange={(e) => {
                  setBillingStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Status: Todos</option>
                <option value="paid">Em dia</option>
                <option value="partial">Parcial</option>
                <option value="overdue">Atrasado</option>
                <option value="canceled">Cancelado</option>
                <option value="paused">Pausado</option>
              </select>
            </div>
          </div>

          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>Email do dono</th>
                  <th>Equipe</th>
                  <th>Serviços</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {loadingTable ? (
                  <tr>
                    <td colSpan={6} className={s.cellEmpty}>
                      Carregando…
                    </td>
                  </tr>
                ) : tableError ? (
                  <tr>
                    <td colSpan={6} className={s.cellError}>
                      Erro ao carregar: {tableError}
                    </td>
                  </tr>
                ) : students.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={s.cellEmpty}>
                      Nenhum aluno encontrado.
                    </td>
                  </tr>
                ) : (
                  students.map((row) => (
                    <StudentRowView
                      key={row.slug}
                      row={row}
                      selected={current?.slug === row.slug}
                      services={servicesBySlug[row.slug]}
                      onOpen={() => openDetail(row)}
                      onEdit={() => setStudentModal({ editingSlug: row.slug })}
                      onAccess={() => onAccessFlow(row)}
                      onDelete={() => onDelete(row)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className={s.pagination}>
            <span>
              Mostrando <strong>{first}–{last}</strong> de <strong>{total}</strong> alunos
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

      {/* Coluna 2: detalhe */}
      {current && (
        <aside className={s.detail}>
          <div className={s.detailHead}>
            <button className={s.detailClose} title="Fechar" onClick={closeDetail}>
              ×
            </button>
            <div className={s.detailHeadTop}>
              <div className={s.avatar}>{initials(current.name || current.slug)}</div>
              <div className={s.detailHeadInfo}>
                <h3>{current.name || current.slug}</h3>
                <div className={s.detailEmail}>{current.owner_email || current.slug}</div>
              </div>
            </div>
            <div className={s.detailRatingRow}>
              <div>
                <StarRow rating={current.rating_avg} />
                <span className={s.ratingValue}>{fmtRating(current.rating_avg)}</span>
              </div>
              <span>
                {current.contract_started_at ? `Desde ${fmtDate(current.contract_started_at)}` : current.billing_status || '—'}
              </span>
            </div>
          </div>

          <div className={s.detailStats}>
            <Stat value={current.team_count ?? 0} label="Equipe" />
            <Stat value={current.services_count ?? 0} label="Serviços" />
            <Stat value={current.ratings_count ?? 0} label="Avaliações" />
            <Stat value={current.contract_started_at ? fmtDate(current.contract_started_at) : '—'} label="Contrato" />
          </div>

          <div className={s.section}>
            <h4 className={s.sectionTitle}>
              Integrantes da equipe
              <span className={s.count}>
                {team.length} pessoa{team.length === 1 ? '' : 's'}
              </span>
            </h4>
            {detailLoading ? (
              <div className={s.placeholder}>Carregando…</div>
            ) : team.length === 0 ? (
              <div className={s.placeholder}>Nenhum integrante atribuído ainda.</div>
            ) : (
              <div className={s.teamList}>
                {team.map((m) => {
                  const ravg = parseFloat(String(m.rating_avg)) || 0;
                  const rcnt = parseInt(String(m.rating_count), 10) || 0;
                  return (
                    <div className={s.teamItem} key={m.assignment_id}>
                      <div className={s.avatar}>{initials(m.user_name)}</div>
                      <div className={s.teamInfo}>
                        <div className={s.teamName}>{m.user_name}</div>
                        <div className={s.teamRole} style={{ color: m.position_color || 'var(--muted)' }}>
                          {m.position_name}
                        </div>
                        {rcnt > 0 ? (
                          <span className={s.teamRating} title={`${rcnt} avalia${rcnt === 1 ? 'ção' : 'ções'} deste aluno`}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 2l2.39 7.36H22l-6.18 4.49L18.18 22 12 17.27 5.82 22l2.36-8.15L2 9.36h7.61z" />
                            </svg>
                            {ravg.toFixed(2).replace('.', ',')} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>({rcnt})</span>
                          </span>
                        ) : (
                          <span className={`${s.teamRating} ${s.empty}`} title="Sem avaliações ainda">
                            — sem avaliações
                          </span>
                        )}
                      </div>
                      <button className={s.iconBtn} title="Remover" onClick={() => onRemoveTeam(m.assignment_id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <button type="button" className={`${s.btn} ${s.btnGhost} ${s.addBtn}`} onClick={() => setTeamModal(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Adicionar integrante
            </button>
          </div>

          <div className={s.section}>
            <h4 className={s.sectionTitle}>Serviços contratados</h4>
            {detailLoading ? <div className={s.placeholder}>Carregando…</div> : <ServiceGrid services={services} />}
          </div>

          <div className={s.section}>
            <h4 className={s.sectionTitle}>
              Demandas em aberto <span className={s.count}>via ClickUp (futuro)</span>
            </h4>
            <div className={s.placeholder}>As demandas serão exibidas quando integrarmos com o ClickUp.</div>
          </div>

          <div className={s.section}>
            <h4 className={s.sectionTitle}>Métricas</h4>
            <div className={s.metrics}>
              <Metric label="Avaliação média" value={fmtRating(current.rating_avg)} pct={(ratingAvg / 5) * 100} green />
              <Metric label="Avaliações totais" value={current.ratings_count ?? 0} pct={0} />
              <Metric
                label="Serviços ativos"
                value={current.services_count ?? 0}
                pct={Math.min(100, (current.services_count || 0) * 14)}
                green
              />
              <Metric label="Integrantes" value={current.team_count ?? 0} pct={Math.min(100, (current.team_count || 0) * 20)} />
            </div>
          </div>
        </aside>
      )}

      {studentModal && (
        <StudentModal
          editing={studentModal.editingSlug ? students.find((x) => x.slug === studentModal.editingSlug) ?? null : null}
          onClose={() => setStudentModal(null)}
          onSaved={async () => {
            setStudentModal(null);
            await Promise.all([load(), loadStats()]);
          }}
        />
      )}

      {teamModal && current && (
        <TeamModal
          slug={current.slug}
          operators={operators}
          team={team}
          onClose={() => setTeamModal(false)}
          onAdded={async () => {
            setTeamModal(false);
            await refreshCurrent();
          }}
        />
      )}

      {creds && <CredentialsModal {...creds} onClose={() => setCreds(null)} />}
    </div>
  );
}

// ── Subcomponentes ──
function Kpi({ label, value, bg, color, icon }: { label: string; value?: number; bg: string; color: string; icon: string }) {
  return (
    <div className={s.kpiCard}>
      <div className={s.kpiIcon} style={{ background: bg, color }}>
        <KpiIcon name={icon} />
      </div>
      <div>
        <div className={s.kpiLabel}>{label}</div>
        <div className={s.kpiValue}>{value ?? '—'}</div>
      </div>
    </div>
  );
}

function KpiIcon({ name }: { name: string }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'check')
    return (
      <svg {...common}>
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  if (name === 'alert')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  if (name === 'team')
    return (
      <svg {...common}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </svg>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className={s.detailStat}>
      <div className={s.detailStatValue}>{value}</div>
      <div className={s.detailStatLabel}>{label}</div>
    </div>
  );
}

function Metric({ label, value, pct, green }: { label: string; value: React.ReactNode; pct: number; green?: boolean }) {
  return (
    <div className={s.metricCard}>
      <div className={s.metricLabel}>{label}</div>
      <div className={s.metricValue}>{value}</div>
      <div className={s.metricBar}>
        <div className={`${s.metricBarFill} ${green ? s.green : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StudentRowView({
  row,
  selected,
  services,
  onOpen,
  onEdit,
  onAccess,
  onDelete,
}: {
  row: StudentRow;
  selected: boolean;
  services?: ServiceRow[];
  onOpen: () => void;
  onEdit: () => void;
  onAccess: () => void;
  onDelete: () => void;
}) {
  let dueBadge: React.ReactNode = null;
  const nearest = nearestDueService(services || []);
  if (nearest && nearest.access_until) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(nearest.access_until);
    const diff = Math.ceil((due.getTime() - today.getTime()) / 86400000);
    const label = canonicalServiceName(nearest.service_type);
    if (diff < 0) dueBadge = <div className={`${s.dueWarn} ${s.late}`}>⚠ {label} vencido</div>;
    else if (diff <= 7) dueBadge = <div className={`${s.dueWarn} ${s.soon}`}>⚠ {label} vence em {diff}d</div>;
    else if (diff <= 18) dueBadge = <div className={`${s.dueWarn} ${s.future}`}>{label} — {due.toLocaleDateString('pt-BR')}</div>;
  }
  const b = billingBadge(row.billing_status);
  return (
    <tr className={selected ? s.selected : ''} onClick={onOpen}>
      <td>
        <div className={s.userCell}>
          <div className={s.avatar}>{initials(row.name || row.slug)}</div>
          <div>
            <div className={s.userName}>{row.name || row.slug}</div>
            <div className={s.userId}>{row.slug}</div>
            {dueBadge}
          </div>
        </div>
      </td>
      <td>
        <span style={{ color: 'var(--muted)' }}>{row.owner_email || '—'}</span>
      </td>
      <td>
        <strong>{row.team_count ?? 0}</strong>
      </td>
      <td>
        <strong>{row.services_count ?? 0}</strong>
      </td>
      <td>
        <span className={`${s.badge} ${b.cls}`}>{b.txt}</span>
      </td>
      <td style={{ textAlign: 'right' }}>
        <div className={s.rowActions} onClick={(e) => e.stopPropagation()}>
          <button className={s.iconBtn} title="Editar" onClick={onEdit}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
          <button className={s.iconBtn} title="Gerar acesso de login" onClick={onAccess}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
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

function ServiceGrid({ services }: { services: ServiceRow[] }) {
  const active = services.filter((sv) => sv.status === 'active');
  const delinquent = services.filter((sv) => sv.status === 'delinquent');
  if (active.length === 0 && delinquent.length === 0) {
    return <div className={s.placeholder}>Nenhum serviço contratado.</div>;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function sortByDue(list: ServiceRow[]) {
    return [...list].sort((a, b) => {
      const da = a.access_until ? new Date(a.access_until).getTime() : new Date('9999-12-31').getTime();
      const db = b.access_until ? new Date(b.access_until).getTime() : new Date('9999-12-31').getTime();
      return da - db;
    });
  }

  function Chip({ sv, delinquentCls }: { sv: ServiceRow; delinquentCls?: boolean }) {
    const meta = serviceChipMeta(sv.service_type);
    let due: React.ReactNode = null;
    if (sv.access_until) {
      const d = new Date(sv.access_until);
      const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000);
      if (diff < 0) due = <span className={`${s.dueTag} ${s.late}`}>Vencido</span>;
      else if (diff <= 7) due = <span className={`${s.dueTag} ${s.soon}`}>Vence em {diff}d</span>;
      else if (diff <= 18) due = <span className={`${s.dueTag} ${s.future}`}>até {d.toLocaleDateString('pt-BR')}</span>;
    }
    return (
      <div className={`${s.serviceChip} ${(s as Record<string, string>)[meta.cls]} ${delinquentCls ? s.delinquent : ''}`}>
        <span className={s.dot} />
        {meta.label}
        {due}
      </div>
    );
  }

  return (
    <div className={s.serviceGrid}>
      {active.length > 0 && (
        <>
          {delinquent.length > 0 && <div className={s.serviceLabel}>Ativos</div>}
          {sortByDue(active).map((sv) => (
            <Chip key={sv.id} sv={sv} />
          ))}
        </>
      )}
      {delinquent.length > 0 && (
        <>
          <div className={`${s.serviceLabel} ${s.late}`}>⚠ Aguardando pagamento</div>
          {sortByDue(delinquent).map((sv) => (
            <Chip key={sv.id} sv={sv} delinquentCls />
          ))}
        </>
      )}
    </div>
  );
}

// ── Modal aluno ──
function StudentModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: StudentRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name || '');
  const [slug, setSlug] = useState(editing?.slug || '');
  const [color, setColor] = useState(editing?.primary_color || '#F29725');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const display_name = name.trim();
      if (editing) {
        await updateStudent(editing.slug, { display_name, primary_color: color });
        toast('Aluno atualizado.');
      } else {
        await createStudent({ slug: slug.trim().toLowerCase(), display_name, primary_color: color });
        toast('Aluno criado.');
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
          <h3>{editing ? 'Editar aluno' : 'Criar aluno'}</h3>
          <button type="button" className={s.modalClose} onClick={onClose}>
            ×
          </button>
        </div>
        <form className={s.modalBody} onSubmit={onSubmit}>
          <div className={s.formGroup}>
            <div>
              <label className={s.label}>Nome de exibição</label>
              <input className={s.modalInput} type="text" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            {!editing && (
              <div>
                <label className={s.label}>Slug (URL única)</label>
                <input
                  className={s.modalInput}
                  type="text"
                  required
                  pattern="[a-z0-9-]+"
                  placeholder="nome-do-aluno"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
                <small className={s.hint}>Letras minúsculas, números e hífen. Não pode ser alterado depois.</small>
              </div>
            )}
            <div>
              <label className={s.label}>Cor primária</label>
              <input className={s.colorInput} type="color" value={color} onChange={(e) => setColor(e.target.value)} />
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

// ── Modal equipe ──
function TeamModal({
  slug,
  operators,
  team,
  onClose,
  onAdded,
}: {
  slug: string;
  operators: OperatorOption[];
  team: TeamMember[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [contracted, setContracted] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [operatorId, setOperatorId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const c = await getStudentContractedPositions(slug);
        setContracted(new Set(c.map((x) => x.position_id)));
      } catch (e) {
        console.error('Erro ao buscar setores contratados:', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, [slug]);

  const assignedOpIds = new Set(team.map((m) => m.operator_id || m.user_id).filter(Boolean));
  const occupiedSectors = new Set(team.map((m) => m.position_id).filter(Boolean) as string[]);

  const availableOps = operators.filter(
    (o) =>
      !assignedOpIds.has(o.id) &&
      !(o.position_id && occupiedSectors.has(o.position_id)) &&
      (contracted.size === 0 ? true : !!o.position_id && contracted.has(o.position_id)),
  );

  const grouped = useMemo(() => {
    const g: Record<string, OperatorOption[]> = {};
    availableOps.forEach((o) => {
      const sector = o.position_name || 'Outros';
      if (!g[sector]) g[sector] = [];
      g[sector].push(o);
    });
    return g;
  }, [availableOps]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (!operatorId) throw new Error('Selecione um operador.');
      await assignTeamMember({ client_slug: slug, operator_id: operatorId, notes: notes.trim() });
      toast('Integrante adicionado.');
      onAdded();
    } catch (ex) {
      setError((ex as Error).message || String(ex));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={s.modalOverlay} style={{ zIndex: 101 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modalCard}>
        <div className={s.modalHead}>
          <h3>Adicionar integrante</h3>
          <button type="button" className={s.modalClose} onClick={onClose}>
            ×
          </button>
        </div>
        <form className={s.modalBody} onSubmit={onSubmit}>
          <div className={s.formGroup}>
            <div>
              <label className={s.label}>Operador</label>
              <select className={s.modalInput} required value={operatorId} onChange={(e) => setOperatorId(e.target.value)}>
                {!loaded ? (
                  <option value="">— carregando —</option>
                ) : availableOps.length === 0 ? (
                  <option value="">— nenhum operador disponível —</option>
                ) : (
                  <>
                    <option value="">— selecione —</option>
                    {Object.keys(grouped)
                      .sort()
                      .map((sector) => (
                        <optgroup key={sector} label={sector}>
                          {grouped[sector].map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name} — {sector}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                  </>
                )}
              </select>
              <small className={s.hint}>
                Apenas operadores com contrato ativo, de setores contratados pelo aluno e ainda não atribuídos.
              </small>
            </div>
            <div>
              <label className={s.label}>Notas (opcional)</label>
              <input className={s.modalInput} type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          {error && <div className={s.formError}>{error}</div>}
          <div className={s.modalFoot}>
            <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={saving}>
              {saving ? 'Adicionando…' : 'Adicionar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal credenciais ──
function CredentialsModal({
  name,
  email,
  password,
  onClose,
}: {
  name: string;
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  function copy(value: string, which: 'email' | 'pass') {
    try {
      navigator.clipboard.writeText(value);
    } catch {
      /* ignore */
    }
    if (which === 'email') {
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 1500);
    } else {
      setCopiedPass(true);
      setTimeout(() => setCopiedPass(false), 1500);
    }
  }

  return (
    <div className={s.modalOverlay} style={{ zIndex: 300 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modalCard} style={{ maxWidth: 440 }}>
        <div className={s.modalHead}>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Acesso criado ✓</div>
            <div style={{ fontSize: '.82rem', color: 'var(--muted)', marginTop: 2 }}>
              {name} — envie estes dados manualmente ao aluno.
            </div>
          </div>
        </div>
        <div className={s.modalBody} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className={s.credLabel}>E-mail</div>
            <div className={s.credField}>
              <input className={s.credInput} readOnly value={email} />
              <button type="button" className={s.credCopy} onClick={() => copy(email, 'email')}>
                {copiedEmail ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
          <div>
            <div className={s.credLabel}>Senha</div>
            <div className={s.credField}>
              <input className={`${s.credInput} ${s.mono}`} readOnly value={password} />
              <button type="button" className={s.credCopy} onClick={() => copy(password, 'pass')}>
                {copiedPass ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
          <div className={s.credWarn}>
            ⚠️ Esta senha <strong>não será exibida de novo</strong>. Copie e envie agora. Uma{' '}
            <strong>reunião de configuração</strong> foi marcada como pendente para este aluno.
          </div>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} style={{ justifyContent: 'center' }} onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
