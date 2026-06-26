'use client';

// Painel financeiro do cliente (operacional/manual) — para o financeiro registrar
// pagamentos, adiantamentos e acordos FORA da Hotmart. Tudo estende a MESMA régua
// (services.access_until) via RPCs, então convive com o fluxo automático da Hotmart.

import { useCallback, useEffect, useState } from 'react';
import {
  listClientServices,
  listClientPayments,
  listClientAgreements,
  listClientHotmartCharges,
  registerManualPayment,
  createAgreement,
  settleInstallment,
  setServiceBillingSource,
  type ClientServiceRow,
  type PaymentRow,
  type AgreementRow,
  type AgreementInstallmentInput,
  type HotmartChargeRow,
} from '@/lib/api/admin-assinaturas';
import { canonicalServiceName } from '@/lib/api/admin-alunos';
import { toast } from '@/lib/toast';

const METHODS = ['pix', 'boleto', 'transferencia', 'dinheiro', 'cartao', 'outro'];
const fmtBRL = (v: number) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (s?: string | null) => (s ? s.split('-').reverse().join('/') : '—');
const sourceLabel = (s: string) => (s === 'hotmart' ? '🔄 Automático (Hotmart)' : s === 'manual' ? '✋ Manual' : '🎁 Cortesia');

export default function FinanceClientModal({
  clientSlug,
  clientName,
  onClose,
  onChanged,
}: {
  clientSlug: string;
  clientName: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<'mes-a-mes' | 'pagamento' | 'acordos' | 'servicos' | 'historico'>('mes-a-mes');
  const [services, setServices] = useState<ClientServiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [agreements, setAgreements] = useState<AgreementRow[]>([]);
  const [charges, setCharges] = useState<HotmartChargeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, a, c] = await Promise.all([
        listClientServices(clientSlug),
        listClientPayments(clientSlug),
        listClientAgreements(clientSlug),
        listClientHotmartCharges(clientSlug),
      ]);
      setServices(s);
      setPayments(p);
      setAgreements(a);
      setCharges(c);
    } catch (e) {
      toast('Erro ao carregar financeiro: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setLoading(false);
    }
  }, [clientSlug]);

  useEffect(() => {
    void reload();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reload, onClose]);

  // ── Form: registrar pagamento / adiantamento ──
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('pix');
  const [payDate, setPayDate] = useState(todayStr());
  const [payMonths, setPayMonths] = useState(1);
  const [payWholePlan, setPayWholePlan] = useState(true);
  const [paySvcIds, setPaySvcIds] = useState<Set<string>>(new Set());
  const [payUntil, setPayUntil] = useState('');
  const [payNotes, setPayNotes] = useState('');

  function toggleSvc(id: string) {
    setPaySvcIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payAmount || Number(payAmount) <= 0) return toast('Informe o valor.', 'warning');
    if (!payWholePlan && paySvcIds.size === 0) return toast('Selecione ao menos um serviço.', 'warning');
    setBusy(true);
    try {
      await registerManualPayment({
        client_slug: clientSlug,
        amount: Number(payAmount),
        method: payMethod,
        paid_at: payDate,
        whole_plan: payWholePlan,
        service_ids: payWholePlan ? [] : [...paySvcIds],
        months: payMonths,
        new_access_until: payUntil || null,
        notes: payNotes || null,
      });
      toast(payMonths > 1 ? 'Adiantamento registrado.' : 'Pagamento registrado.', 'success');
      setPayAmount('');
      setPayNotes('');
      setPayMonths(1);
      setPayUntil('');
      await reload();
      onChanged?.();
    } catch (ex) {
      toast('Erro: ' + (ex instanceof Error ? ex.message : String(ex)), 'error');
    } finally {
      setBusy(false);
    }
  }

  // ── Form: criar acordo (parcelas customizáveis) ──
  const [agrTitle, setAgrTitle] = useState('');
  const [agrNotes, setAgrNotes] = useState('');
  const [agrRows, setAgrRows] = useState<AgreementInstallmentInput[]>([{ due_date: todayStr(), amount: 0 }]);

  function setAgrRow(i: number, patch: Partial<AgreementInstallmentInput>) {
    setAgrRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  const agrTotal = agrRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  async function submitAgreement(e: React.FormEvent) {
    e.preventDefault();
    if (!agrTitle.trim()) return toast('Dê um título ao acordo.', 'warning');
    const installments = agrRows.filter((r) => r.due_date && Number(r.amount) > 0);
    if (installments.length === 0) return toast('Adicione ao menos uma parcela válida.', 'warning');
    setBusy(true);
    try {
      await createAgreement({ client_slug: clientSlug, title: agrTitle.trim(), notes: agrNotes || null, installments });
      toast('Acordo criado.', 'success');
      setAgrTitle('');
      setAgrNotes('');
      setAgrRows([{ due_date: todayStr(), amount: 0 }]);
      await reload();
    } catch (ex) {
      toast('Erro: ' + (ex instanceof Error ? ex.message : String(ex)), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(installmentId: string) {
    if (!confirm('Marcar esta parcela como paga? (estende o acesso do plano inteiro em +1 mês)')) return;
    setBusy(true);
    try {
      await settleInstallment({ installment_id: installmentId, method: 'pix', paid_at: todayStr(), extend: true, whole_plan: true, months: 1 });
      toast('Parcela quitada.', 'success');
      await reload();
      onChanged?.();
    } catch (ex) {
      toast('Erro: ' + (ex instanceof Error ? ex.message : String(ex)), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleSource(svc: ClientServiceRow) {
    const next = svc.billing_source === 'manual' ? 'hotmart' : 'manual';
    setBusy(true);
    try {
      await setServiceBillingSource(svc.id, next);
      toast(`Serviço agora é ${next === 'manual' ? 'Manual' : 'Automático (Hotmart)'}.`, 'success');
      await reload();
    } catch (ex) {
      toast('Erro: ' + (ex instanceof Error ? ex.message : String(ex)), 'error');
    } finally {
      setBusy(false);
    }
  }

  const initials = clientName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·';
  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(20,16,40,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 };
  const dialog: React.CSSProperties = { background: '#fff', borderRadius: 18, width: 'min(1080px, 100%)', maxHeight: '92vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(20,16,40,.28)' };
  const headWrap: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2, background: '#fff' };
  const head: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 24px 14px', background: 'linear-gradient(180deg, rgba(242,151,37,.10), rgba(242,151,37,0))' };
  const avatarLg: React.CSSProperties = { width: 44, height: 44, borderRadius: 12, background: 'var(--avatar-gradient, linear-gradient(135deg,#f29725,#d97706))', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '.95rem', flexShrink: 0, boxShadow: '0 2px 8px rgba(242,151,37,.3)' };
  const tabsBar: React.CSSProperties = { display: 'flex', gap: 6, padding: '4px 24px 12px', borderBottom: '1px solid var(--border)', overflowX: 'auto' };
  const body: React.CSSProperties = { padding: 24 };
  const tabBtn = (active: boolean): React.CSSProperties => ({ padding: '7px 14px', border: '1px solid', borderColor: active ? 'transparent' : 'var(--border)', borderRadius: 999, background: active ? 'var(--accent)' : '#fff', cursor: 'pointer', fontWeight: active ? 700 : 600, color: active ? '#fff' : 'var(--muted)', fontSize: '.82rem', whiteSpace: 'nowrap' });
  const label: React.CSSProperties = { display: 'block', fontSize: '.78rem', fontWeight: 600, color: 'var(--muted)', margin: '10px 0 4px' };
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: '.9rem' };
  const primary: React.CSSProperties = { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 700, cursor: 'pointer' };

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={dialog} role="dialog" aria-modal="true" aria-label={`Financeiro de ${clientName}`}>
        <div style={headWrap}>
          <div style={head}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
              <div style={avatarLg}>{initials}</div>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, letterSpacing: '-.01em' }}>{clientName}</h3>
                <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Financeiro do aluno · situação de cobrança, pagamentos e acordos</div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'var(--bg, #f4f4f5)', border: '1px solid var(--border)', borderRadius: 10, width: 34, height: 34, fontSize: 20, lineHeight: 1, cursor: 'pointer', color: 'var(--muted)', flexShrink: 0 }}>×</button>
          </div>
          <div style={tabsBar}>
            <button style={tabBtn(tab === 'mes-a-mes')} onClick={() => setTab('mes-a-mes')}>Mês a mês</button>
            <button style={tabBtn(tab === 'pagamento')} onClick={() => setTab('pagamento')}>Registrar pagamento</button>
            <button style={tabBtn(tab === 'acordos')} onClick={() => setTab('acordos')}>Acordos</button>
            <button style={tabBtn(tab === 'servicos')} onClick={() => setTab('servicos')}>Serviços</button>
            <button style={tabBtn(tab === 'historico')} onClick={() => setTab('historico')}>Histórico</button>
          </div>
        </div>

        <div style={body}>
          {!loading && <ExecSummary charges={charges} services={services} />}
          {loading ? (
            <p style={{ color: 'var(--muted)' }}>Carregando…</p>
          ) : tab === 'mes-a-mes' ? (
            <MonthlyGrid charges={charges} />
          ) : tab === 'pagamento' ? (
            <form onSubmit={submitPayment}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={label}>Valor recebido</label>
                  <input style={input} type="number" step="0.01" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0,00" />
                </div>
                <div>
                  <label style={label}>Forma</label>
                  <select style={input} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                    {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Data do pagamento</label>
                  <input style={input} type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                </div>
                <div>
                  <label style={label}>Meses pagos (adiantamento = 2+)</label>
                  <input style={input} type="number" min={1} max={24} value={payMonths} onChange={(e) => setPayMonths(Math.max(1, Number(e.target.value) || 1))} />
                </div>
              </div>

              <label style={label}>O pagamento cobre</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.88rem' }}>
                <input type="checkbox" checked={payWholePlan} onChange={(e) => setPayWholePlan(e.target.checked)} />
                Plano inteiro (todos os serviços ativos)
              </label>
              {!payWholePlan && (
                <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                  {services.length === 0 ? (
                    <span style={{ color: 'var(--muted)', fontSize: '.84rem' }}>Sem serviços ativos.</span>
                  ) : services.map((s) => (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.84rem', padding: '3px 0' }}>
                      <input type="checkbox" checked={paySvcIds.has(s.id)} onChange={() => toggleSvc(s.id)} />
                      {s.service_type} <span style={{ color: 'var(--muted)' }}>· vence {fmtDate(s.access_until)}</span>
                    </label>
                  ))}
                </div>
              )}

              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontSize: '.82rem', color: 'var(--muted)' }}>Opções avançadas (definir validade manualmente)</summary>
                <label style={label}>Validade até (sobrescreve os meses)</label>
                <input style={input} type="date" value={payUntil} onChange={(e) => setPayUntil(e.target.value)} />
              </details>

              <label style={label}>Observação (opcional)</label>
              <input style={input} type="text" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Ex: PIX recebido, comprovante #123" />

              <div style={{ marginTop: 16 }}>
                <button type="submit" style={primary} disabled={busy}>{busy ? 'Salvando…' : 'Registrar pagamento'}</button>
              </div>
            </form>
          ) : tab === 'acordos' ? (
            <>
              <form onSubmit={submitAgreement} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
                <strong style={{ fontSize: '.9rem' }}>Novo acordo</strong>
                <label style={label}>Título</label>
                <input style={input} type="text" value={agrTitle} onChange={(e) => setAgrTitle(e.target.value)} placeholder="Ex: Acordo de regularização — 3x" />
                <label style={label}>Parcelas</label>
                {agrRows.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input style={{ ...input, flex: 1 }} type="date" value={r.due_date} onChange={(e) => setAgrRow(i, { due_date: e.target.value })} />
                    <input style={{ ...input, width: 130 }} type="number" step="0.01" min="0" value={r.amount || ''} onChange={(e) => setAgrRow(i, { amount: Number(e.target.value) || 0 })} placeholder="valor" />
                    {agrRows.length > 1 && (
                      <button type="button" onClick={() => setAgrRows((p) => p.filter((_, idx) => idx !== i))} style={{ border: '1px solid var(--border)', background: 'none', borderRadius: 8, cursor: 'pointer', padding: '0 10px' }}>×</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setAgrRows((p) => [...p, { due_date: todayStr(), amount: 0 }])} style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: '.82rem' }}>+ Parcela</button>
                <label style={label}>Observação</label>
                <input style={input} type="text" value={agrNotes} onChange={(e) => setAgrNotes(e.target.value)} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                  <span style={{ fontWeight: 700 }}>Total: {fmtBRL(agrTotal)}</span>
                  <button type="submit" style={primary} disabled={busy}>{busy ? 'Salvando…' : 'Criar acordo'}</button>
                </div>
              </form>

              {agreements.length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: '.86rem' }}>Nenhum acordo registrado.</p>
              ) : agreements.map((a) => (
                <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{a.title}</strong>
                    <span style={{ fontSize: '.78rem', color: a.status === 'completed' ? 'var(--success-strong, green)' : 'var(--muted)' }}>{a.status === 'completed' ? 'Quitado' : 'Ativo'} · {fmtBRL(a.total_amount)}</span>
                  </div>
                  {a.installments.map((i) => (
                    <div key={i.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', fontSize: '.84rem', borderTop: '1px solid var(--border)' }}>
                      <span>Parcela {i.seq} · vence {fmtDate(i.due_date)} · {fmtBRL(i.amount)}</span>
                      {i.status === 'paid' ? (
                        <span style={{ color: 'var(--success-strong, green)', fontWeight: 600 }}>paga {fmtDate(i.paid_at)}</span>
                      ) : (
                        <button type="button" onClick={() => void markPaid(i.id)} disabled={busy} style={{ border: 'none', background: 'var(--accent-soft)', color: 'var(--accent-strong)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>Marcar paga</button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </>
          ) : tab === 'servicos' ? (
            services.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '.86rem' }}>Sem serviços ativos.</p>
            ) : services.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                <div>
                  <strong style={{ fontSize: '.9rem' }}>{s.service_type}</strong>
                  <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>vence {fmtDate(s.access_until)} · {fmtBRL(s.monthly_value || 0)}/mês · {sourceLabel(s.billing_source)}</div>
                </div>
                <button type="button" onClick={() => void toggleSource(s)} disabled={busy} style={{ border: '1px solid var(--border)', background: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: '.8rem' }}>
                  {s.billing_source === 'manual' ? '→ Hotmart' : '→ Manual'}
                </button>
              </div>
            ))
          ) : (
            payments.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '.86rem' }}>Nenhum pagamento registrado.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                    <th style={{ padding: 6 }}>Data</th><th style={{ padding: 6 }}>Valor</th><th style={{ padding: 6 }}>Forma</th><th style={{ padding: 6 }}>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 6 }}>{fmtDate(p.paid_at)}</td>
                      <td style={{ padding: 6 }}>{fmtBRL(p.amount)}{p.months > 1 ? ` (${p.months}m)` : ''}</td>
                      <td style={{ padding: 6 }}>{p.method || '—'}</td>
                      <td style={{ padding: 6 }}>{p.source === 'hotmart' ? '🔄 Hotmart' : '✋ Manual'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ── Grade "Mês a mês por serviço" ──
// Lê as cobranças Hotmart (portal.hotmart_purchases) do aluno e monta uma matriz
// serviço × mês: cada célula mostra se aquele mês foi pago, ficou vencido, ou foi
// estornado/cancelado. Soma o total em aberto (status 'overdue').
const PAID = new Set(['approved', 'complete']);
const MONTH_LABELS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const cellFor = (st: string | undefined): { bg: string; mark: string; title: string } => {
  if (st === 'overdue') return { bg: '#fee2e2', mark: '✕', title: 'Vencido / não pago' };
  if (st && PAID.has(st)) return { bg: '#dcfce7', mark: '✓', title: 'Pago' };
  if (st === 'refunded') return { bg: '#fef3c7', mark: '↩', title: 'Reembolsado' };
  if (st === 'canceled') return { bg: '#f1f5f9', mark: '–', title: 'Cancelado' };
  if (st === 'chargeback') return { bg: '#fee2e2', mark: '⚠', title: 'Chargeback' };
  return { bg: 'transparent', mark: '', title: 'Sem cobrança' };
};

function MonthlyGrid({ charges }: { charges: HotmartChargeRow[] }) {
  if (charges.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: '.86rem' }}>Nenhuma cobrança Hotmart registrada para este aluno.</p>;
  }

  // serviço (chave) -> { label, byMonth: { 'YYYY-MM': status }, overdueTotal }
  const svcMap = new Map<string, { label: string; byMonth: Record<string, string>; overdue: number; paid: number }>();
  const monthsSet = new Set<string>();
  for (const c of charges) {
    // Agrupa pelo nome CANÔNICO do serviço (mesma normalização das demais telas):
    // unifica variações da Hotmart ("Web Design"/"Web Designer", "Tráfego"/"Gestão de
    // Tráfego") e sufixos como "… Vencido" numa única linha, evitando duplicatas.
    const key = canonicalServiceName(c.service_name || c.offer_code || '');
    const label = key;
    const ym = (c.charged_at || '').slice(0, 7);
    if (!ym) continue;
    monthsSet.add(ym);
    if (!svcMap.has(key)) svcMap.set(key, { label, byMonth: {}, overdue: 0, paid: 0 });
    const row = svcMap.get(key)!;
    // se já houver um 'pago' no mês, ele prevalece sobre um 'overdue' anterior (retentativa paga)
    const prev = row.byMonth[ym];
    if (!prev || (c.status && PAID.has(c.status))) row.byMonth[ym] = c.status;
    if (c.status === 'overdue') row.overdue += Number(c.amount || 0);
    if (c.status && PAID.has(c.status)) row.paid += Number(c.amount || 0);
  }
  const months = Array.from(monthsSet).sort();
  const rows = Array.from(svcMap.values()).sort((a, b) => b.overdue - a.overdue);
  const monthHdr = (ym: string) => {
    const [y, m] = ym.split('-');
    return `${MONTH_LABELS[Number(m) - 1]}/${y.slice(2)}`;
  };

  return (
    <div>
      <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginBottom: 8 }}>
        <span style={{ color: '#15803d' }}>✓ pago</span> &nbsp;·&nbsp;
        <span style={{ color: '#b91c1c' }}>✕ vencido</span> &nbsp;·&nbsp;
        <span style={{ color: '#92400e' }}>↩ reembolsado</span> &nbsp;·&nbsp;
        <span>– cancelado</span> &nbsp;·&nbsp; (vazio = sem cobrança no mês)
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '.78rem', width: '100%' }}>
          <thead>
            <tr style={{ background: '#fafbfc' }}>
              <th style={{ ...gridTh, position: 'sticky', left: 0, background: '#fafbfc', textAlign: 'left', minWidth: 130 }}>Serviço</th>
              {months.map((m) => <th key={m} style={gridTh}>{monthHdr(m)}</th>)}
              <th style={{ ...gridTh, minWidth: 86 }}>Em aberto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ ...gridTd, position: 'sticky', left: 0, background: '#fff', textAlign: 'left', fontWeight: 600 }}>{r.label}</td>
                {months.map((m) => {
                  const c = cellFor(r.byMonth[m]);
                  return <td key={m} style={{ ...gridTd, background: c.bg }} title={`${r.label} · ${monthHdr(m)} · ${c.title}`}>{c.mark}</td>;
                })}
                <td style={{ ...gridTd, fontWeight: 700, color: r.overdue > 0 ? '#b91c1c' : 'var(--muted)' }}>{r.overdue > 0 ? fmtBRL(r.overdue) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Resumo executivo: visão consolidada da situação financeira do aluno ──
// Derivado das cobranças Hotmart (charges) + serviços ativos. Fica no topo do modal,
// visível em qualquer aba, para leitura rápida da situação de pagamento.
function ExecSummary({ charges, services }: { charges: HotmartChargeRow[]; services: ClientServiceRow[] }) {
  let paid = 0;
  let overdue = 0;
  let overdueCount = 0;
  let paidCount = 0;
  const months = new Set<string>();
  for (const c of charges) {
    const amt = Number(c.amount || 0);
    const ym = (c.charged_at || '').slice(0, 7);
    if (ym) months.add(ym);
    if (c.status && PAID.has(c.status)) {
      paid += amt;
      paidCount++;
    } else if (c.status === 'overdue') {
      overdue += amt;
      overdueCount++;
    }
  }
  const hoje = todayStr();
  const ativos = services.length;
  const ticket = services.reduce((s, x) => s + Number(x.monthly_value || 0), 0);
  const inadPct = paid + overdue > 0 ? Math.round((overdue / (paid + overdue)) * 100) : 0;
  // Situação = régua de acesso ATUAL (serviços vencidos hoje), mesma base da KPI
  // "Em atraso" da tela — não o histórico de cobranças.
  const svcVencidos = services.filter((s) => s.access_until && s.access_until < hoje).length;
  const accessDates = services.map((s) => s.access_until).filter(Boolean) as string[];
  const accessUntil = accessDates.sort().slice(-1)[0] || null;
  const vencido = accessUntil ? accessUntil < hoje : false;

  const situ = ativos === 0 && charges.length === 0
    ? { txt: 'Sem dados', bg: '#f1f5f9', color: '#475569', sub: 'Nenhum serviço ou cobrança' }
    : svcVencidos > 0
      ? { txt: 'Inadimplente', bg: '#fee2e2', color: '#b91c1c', sub: `${svcVencidos} serviço${svcVencidos > 1 ? 's' : ''} vencido${svcVencidos > 1 ? 's' : ''}` }
      : { txt: 'Em dia', bg: '#dcfce7', color: '#15803d', sub: 'Acesso em vigência' };

  return (
    <div style={{ marginBottom: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
      <div style={{ background: situ.bg, borderRadius: 14, padding: '14px 16px' }}>
        <div style={{ fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: situ.color, opacity: 0.85 }}>Situação</div>
        <div style={{ fontSize: '1.35rem', fontWeight: 800, color: situ.color, lineHeight: 1.1, marginTop: 4 }}>{situ.txt}</div>
        <div style={{ fontSize: '.74rem', color: situ.color, opacity: 0.8, marginTop: 2 }}>{situ.sub}</div>
      </div>
      <StatCard label="Recebido (total)" value={fmtBRL(paid)} sub={`${paidCount} pagamentos · ${months.size} meses`} bg="#ecfdf3" color="#15803d" />
      <StatCard label="Em aberto" value={fmtBRL(overdue)} sub={inadPct > 0 ? `${inadPct}% de inadimplência` : 'tudo pago'} bg="#fef2f2" color="#b91c1c" />
      <StatCard label="Serviços ativos" value={String(ativos)} sub={ticket > 0 ? `${fmtBRL(ticket)}/mês` : '—'} bg="#eef2ff" color="#4338ca" />
      {accessUntil && (
        <StatCard label="Acesso até" value={fmtDate(accessUntil)} sub={vencido ? 'vencido — renovar' : 'em vigência'} bg={vencido ? '#fef2f2' : '#f5f3ff'} color={vencido ? '#b91c1c' : '#6d28d9'} />
      )}
    </div>
  );
}

function StatCard({ label, value, sub, bg, color }: { label: string; value: string; sub?: string; bg: string; color: string }) {
  return (
    <div style={{ background: bg, borderRadius: 14, padding: '14px 16px', border: '1px solid rgba(0,0,0,.04)' }}>
      <div style={{ fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color, opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 800, color, lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: '.74rem', color, opacity: 0.75, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const gridTh: React.CSSProperties = { padding: '8px 6px', fontSize: '.7rem', fontWeight: 700, color: 'var(--muted)', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
const gridTd: React.CSSProperties = { padding: '7px 6px', textAlign: 'center', whiteSpace: 'nowrap' };
