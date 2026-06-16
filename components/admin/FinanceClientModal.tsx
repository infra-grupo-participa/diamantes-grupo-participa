'use client';

// Painel financeiro do cliente (operacional/manual) — para o financeiro registrar
// pagamentos, adiantamentos e acordos FORA da Hotmart. Tudo estende a MESMA régua
// (services.access_until) via RPCs, então convive com o fluxo automático da Hotmart.

import { useCallback, useEffect, useState } from 'react';
import {
  listClientServices,
  listClientPayments,
  listClientAgreements,
  registerManualPayment,
  createAgreement,
  settleInstallment,
  setServiceBillingSource,
  type ClientServiceRow,
  type PaymentRow,
  type AgreementRow,
  type AgreementInstallmentInput,
} from '@/lib/api/admin-assinaturas';
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
  const [tab, setTab] = useState<'pagamento' | 'acordos' | 'servicos' | 'historico'>('pagamento');
  const [services, setServices] = useState<ClientServiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [agreements, setAgreements] = useState<AgreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, a] = await Promise.all([
        listClientServices(clientSlug),
        listClientPayments(clientSlug),
        listClientAgreements(clientSlug),
      ]);
      setServices(s);
      setPayments(p);
      setAgreements(a);
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

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(20,16,40,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 };
  const dialog: React.CSSProperties = { background: '#fff', borderRadius: 16, width: 'min(680px, 100%)', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' };
  const head: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: '#fff' };
  const body: React.CSSProperties = { padding: 22 };
  const tabBtn = (active: boolean): React.CSSProperties => ({ padding: '8px 12px', border: 'none', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent', background: 'none', cursor: 'pointer', fontWeight: active ? 700 : 500, color: active ? 'var(--accent-strong)' : 'var(--muted)', fontSize: '.86rem' });
  const label: React.CSSProperties = { display: 'block', fontSize: '.78rem', fontWeight: 600, color: 'var(--muted)', margin: '10px 0 4px' };
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: '.9rem' };
  const primary: React.CSSProperties = { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 700, cursor: 'pointer' };

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={dialog} role="dialog" aria-modal="true" aria-label={`Financeiro de ${clientName}`}>
        <div style={head}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>💰 Financeiro — {clientName}</h3>
            <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Pagamentos manuais, adiantamentos e acordos (fora da Hotmart)</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--muted)' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '0 22px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 64, background: '#fff', zIndex: 1 }}>
          <button style={tabBtn(tab === 'pagamento')} onClick={() => setTab('pagamento')}>Registrar pagamento</button>
          <button style={tabBtn(tab === 'acordos')} onClick={() => setTab('acordos')}>Acordos</button>
          <button style={tabBtn(tab === 'servicos')} onClick={() => setTab('servicos')}>Serviços</button>
          <button style={tabBtn(tab === 'historico')} onClick={() => setTab('historico')}>Histórico</button>
        </div>

        <div style={body}>
          {loading ? (
            <p style={{ color: 'var(--muted)' }}>Carregando…</p>
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
