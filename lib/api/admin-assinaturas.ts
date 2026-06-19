'use client';

import { createClient } from '@/lib/supabase/client';
import { canonicalServiceName } from '@/lib/api/admin-alunos';

/**
 * admin-assinaturas.ts — camada de dados de Assinaturas / Financeiro.
 * Espelha admin/assets/admin-api.js (seção ASSINATURAS) fielmente.
 */

export type SubscriptionRow = {
  id: string;
  client_slug: string;
  client_name: string;
  owner_email?: string | null;
  plan_name: string;
  monthly_value: number;
  next_billing_date?: string | null;
  payment_method?: string | null;
  payment_method_label?: string | null;
  status: string;
  started_at?: string | null;
  notes?: string | null;
  active_services?: Array<{ service_type?: string; access_until?: string | null }> | null;
};

export type SubscriptionStats = {
  mrr: number;
  active: number;
  paid: number;
  partial: number;
  late: number;
  pending: number;
  canceled: number;
  /**
   * Retenção lifetime = (total − cancelados) / total. Mede quantos assinantes
   * já contratados seguem sem cancelar — não mistura inadimplência (atraso/parcial)
   * com churn. Nota: portal.subscriptions não tem timestamp de cancelamento
   * (canceled_at), então não dá para recortar por período; é uma taxa acumulada.
   */
  retention: number;
};

export type SparkPoint = { label: string; value: number };
export type ServiceByType = { type: string; count: number };
export type MonthlyStat = { month: string; total: number; count: number; bySetor: Record<string, number> };

export type PurchaseRow = {
  transaction_code: string;
  buyer_email: string;
  offer_code?: string | null;
  service_name?: string | null;
  amount: number;
  status: string;
  payment_type?: string | null;
  installments_total?: number | null;
  installment_number?: number | null;
  charged_at?: string | null;
  client_slug?: string | null;
};

export type ServiceRenewal = {
  client_slug: string;
  client_display_name?: string | null;
  service_type?: string | null;
  access_until?: string | null;
  days_left?: number | null;
  monthly_value?: number | null;
};

export type ClientOption = { slug: string; display_name: string };

// ── Listagem ─────────────────────────────────────────────────────────────
export async function listSubscriptions({
  search = '',
  status = 'all',
  limit = 25,
  offset = 0,
}: { search?: string; status?: string; limit?: number; offset?: number } = {}): Promise<{
  data: SubscriptionRow[];
  count: number;
}> {
  const supabase = createClient();
  let q = supabase.from('v_subscriptions').select('*', { count: 'exact' }).order('client_name', { ascending: true });

  if (status && status !== 'all') q = q.eq('status', status);
  if (search && search.trim()) {
    const s = search.trim().replace(/[%_]/g, '');
    q = q.or(`client_name.ilike.%${s}%,client_slug.ilike.%${s}%,owner_email.ilike.%${s}%,plan_name.ilike.%${s}%`);
  }
  q = q.range(offset, offset + limit - 1);

  const { data, count, error } = await q;
  if (error) throw error;
  return { data: (data ?? []) as SubscriptionRow[], count: count ?? 0 };
}

export async function getSubscriptionStats(): Promise<SubscriptionStats> {
  const supabase = createClient();
  const [paid, partial, overdue, pending, canceled, all, sumActive] = await Promise.all([
    supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'paid'),
    supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'partial'),
    supabase.from('subscriptions').select('id', { count: 'exact', head: true }).in('status', ['overdue', 'late']),
    supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'canceled'),
    supabase.from('subscriptions').select('id', { count: 'exact', head: true }),
    supabase.from('subscriptions').select('monthly_value').neq('status', 'canceled'),
  ]);
  for (const r of [paid, partial, overdue, pending, canceled, all, sumActive]) {
    if (r.error) throw r.error;
  }

  const mrr = ((sumActive.data ?? []) as Array<{ monthly_value: number }>).reduce(
    (s, r) => s + Number(r.monthly_value || 0),
    0,
  );
  const paidCount = paid.count ?? 0;
  const partialCount = partial.count ?? 0;
  const overdueCount = overdue.count ?? 0;
  const pendingCount = pending.count ?? 0;
  const canceledCount = canceled.count ?? 0;
  const totalCount = all.count ?? 0;
  const active = paidCount + partialCount + pendingCount + overdueCount;
  // Retenção lifetime: dos assinantes já contratados, quantos não cancelaram.
  const retention = totalCount === 0 ? 0 : Math.round(((totalCount - canceledCount) / totalCount) * 100);

  return {
    mrr,
    active,
    paid: paidCount,
    partial: partialCount,
    late: overdueCount,
    pending: pendingCount,
    canceled: canceledCount,
    retention,
  };
}

/**
 * Somatórios financeiros na granularidade de SERVIÇO (fonte da verdade), via RPC
 * `admin_money_summary` (SECURITY INVOKER + is_admin no banco).
 *
 * Por que RPC e não somar `subscriptions` no front: a tabela `subscriptions` é
 * agregada POR CLIENTE com um único valor e status "pior caso". Somar o valor
 * inteiro de quem está `partial` como "inadimplência" inflava o número (~75%):
 * jogava no balde de atraso serviços que estão em dia. Agora o atraso é a soma
 * só dos serviços de fato vencidos (access_until < hoje).
 */
export async function getSubscriptionMoneySummary(): Promise<{
  late: number;
  onTime: number;
  avg: number;
  clientsOverdue: number;
}> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('admin_money_summary');
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { late?: number; on_time?: number; avg_ticket?: number; clients_overdue?: number }
    | undefined;
  return {
    late: Number(row?.late || 0),
    onTime: Number(row?.on_time || 0),
    avg: Number(row?.avg_ticket || 0),
    clientsOverdue: Number(row?.clients_overdue || 0),
  };
}

export async function getMrrSparkline(): Promise<SparkPoint[]> {
  const supabase = createClient();
  const { data } = await supabase.from('subscriptions').select('monthly_value, started_at, created_at, status');
  if (!data) return [];
  const now = new Date();
  const months: SparkPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const sum = (data as Array<{ monthly_value: number; started_at?: string; created_at?: string; status: string }>)
      .filter((s) => s.status !== 'canceled')
      .filter((s) => {
        const ref = s.started_at ? new Date(s.started_at) : new Date(s.created_at as string);
        return ref < next;
      })
      .reduce((s, r) => s + Number(r.monthly_value || 0), 0);
    months.push({ label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), value: sum });
  }
  return months;
}

export async function getServicesByType(): Promise<ServiceByType[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('services')
    .select('service_type, status, offer_code, metadata')
    .eq('status', 'active');
  if (error) throw error;

  const counts: Record<string, number> = {};
  ((data ?? []) as Array<{ service_type: string }>).forEach((s) => {
    const key = canonicalServiceName(s.service_type);
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

// ── CRUD assinatura ──────────────────────────────────────────────────────
export type SubscriptionPayload = {
  client_slug?: string;
  plan_name: string;
  monthly_value: number;
  next_billing_date?: string | null;
  payment_method?: string;
  payment_method_label?: string | null;
  status?: string;
  started_at?: string | null;
  notes?: string | null;
};

export async function createSubscription(payload: SubscriptionPayload) {
  const required: Array<keyof SubscriptionPayload> = ['client_slug', 'plan_name', 'monthly_value'];
  for (const k of required)
    if (payload[k] === undefined || payload[k] === ('' as unknown)) throw new Error(`${String(k)} obrigatório.`);
  const supabase = createClient();
  const { data, error } = await supabase
    .from('subscriptions')
    .insert({
      client_slug: payload.client_slug,
      plan_name: payload.plan_name,
      monthly_value: Number(payload.monthly_value) || 0,
      next_billing_date: payload.next_billing_date || null,
      payment_method: payload.payment_method || 'pix',
      payment_method_label: payload.payment_method_label || null,
      status: payload.status || 'paid',
      started_at: payload.started_at || null,
      notes: payload.notes || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateSubscription(id: string, patch: Partial<SubscriptionPayload>) {
  if (!id) throw new Error('id obrigatório');
  const allowed: Array<keyof SubscriptionPayload> = [
    'plan_name',
    'monthly_value',
    'next_billing_date',
    'payment_method',
    'payment_method_label',
    'status',
    'started_at',
    'notes',
  ];
  const clean: Record<string, unknown> = {};
  for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
  if (clean.monthly_value !== undefined) clean.monthly_value = Number(clean.monthly_value) || 0;
  clean.updated_at = new Date().toISOString();
  const supabase = createClient();
  const { data, error } = await supabase.from('subscriptions').update(clean).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSubscription(id: string) {
  if (!id) throw new Error('id obrigatório');
  const supabase = createClient();
  const { error } = await supabase.from('subscriptions').delete().eq('id', id);
  if (error) throw error;
  return true;
}

export async function listClientsForSubscription(): Promise<ClientOption[]> {
  const supabase = createClient();
  const [clients, subs] = await Promise.all([
    supabase.from('clients').select('slug, display_name').order('display_name'),
    supabase.from('subscriptions').select('client_slug'),
  ]);
  const has = new Set(((subs.data ?? []) as Array<{ client_slug: string }>).map((s) => s.client_slug));
  return ((clients.data ?? []) as ClientOption[]).filter((c) => !has.has(c.slug));
}

// ── Hotmart ──────────────────────────────────────────────────────────────
export async function listPurchasesHistory({
  limit = 50,
  offset = 0,
  month = '',
  clientSlug = '',
}: { limit?: number; offset?: number; month?: string; clientSlug?: string } = {}): Promise<{
  data: PurchaseRow[];
  count: number;
}> {
  const supabase = createClient();
  let q = supabase
    .schema('portal')
    .from('hotmart_purchases')
    .select(
      'transaction_code, buyer_email, offer_code, service_name, amount, status, payment_type, installments_total, installment_number, charged_at, client_slug',
      { count: 'exact' },
    )
    .order('charged_at', { ascending: false });
  if (month) {
    const [y, m] = month.split('-').map(Number);
    const from = new Date(y, m - 1, 1).toISOString();
    const to = new Date(y, m, 1).toISOString();
    q = q.gte('charged_at', from).lt('charged_at', to);
  }
  if (clientSlug) q = q.eq('client_slug', clientSlug);
  q = q.range(offset, offset + limit - 1);
  const { data, count, error } = await q;
  if (error) throw error;
  return { data: (data ?? []) as PurchaseRow[], count: count ?? 0 };
}

export async function getPurchaseMonthlyStats(): Promise<MonthlyStat[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('portal')
    .from('hotmart_purchases')
    .select('charged_at, amount, status, payment_type, service_name, client_slug')
    .in('status', ['approved', 'complete']);
  if (error) throw error;
  const byMonth: Record<string, MonthlyStat> = {};
  ((data ?? []) as PurchaseRow[]).forEach((p) => {
    const m = (p.charged_at || '').slice(0, 7);
    if (!m) return;
    if (!byMonth[m]) byMonth[m] = { month: m, total: 0, count: 0, bySetor: {} };
    byMonth[m].total += Number(p.amount || 0);
    byMonth[m].count++;
    const setor = canonicalServiceName(p.service_name || '');
    byMonth[m].bySetor[setor] = (byMonth[m].bySetor[setor] || 0) + Number(p.amount || 0);
  });
  return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
}

export type UnlinkedPurchase = {
  transaction_code: string;
  buyer_email: string;
  service_name?: string | null;
  offer_code?: string | null;
  amount: number;
  status: string;
  charged_at?: string | null;
};

/**
 * Compras Hotmart aprovadas/completas que NÃO casaram com nenhum aluno (client_slug NULL).
 * O webhook responde ok mas pula a renovação — o financeiro precisa identificar o aluno
 * e renovar o serviço manualmente (Financeiro manual → registrar pagamento / estender acesso).
 */
export async function listUnlinkedPurchases(): Promise<UnlinkedPurchase[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('portal')
    .from('hotmart_purchases')
    .select('transaction_code, buyer_email, service_name, offer_code, amount, status, charged_at')
    .is('client_slug', null)
    .in('status', ['approved', 'complete'])
    .order('charged_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as UnlinkedPurchase[];
}

/** Todos os alunos (slug + nome) — para o seletor de vínculo de compra. */
export async function listAllClientOptions(): Promise<ClientOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('clients').select('slug, display_name').order('display_name');
  if (error) throw error;
  return (data ?? []) as ClientOption[];
}

/**
 * Vincula uma compra Hotmart órfã a um aluno e, opcionalmente, renova o plano
 * (estende access_until = data da compra + 30, mesma régua da Hotmart). RPC is_admin.
 */
export async function linkHotmartPurchase(
  transactionCode: string,
  clientSlug: string,
  renew: boolean,
): Promise<{ services_updated: number; new_access_until: string | null }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('admin_link_hotmart_purchase', {
    p_transaction_code: transactionCode,
    p_client_slug: clientSlug,
    p_renew: renew,
  });
  if (error) throw new Error(error.message || 'Não foi possível vincular a compra.');
  const row = (data ?? {}) as { services_updated?: number; new_access_until?: string | null };
  return { services_updated: Number(row.services_updated || 0), new_access_until: row.new_access_until ?? null };
}

export async function getServiceRenewals(): Promise<ServiceRenewal[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('v_service_renewals')
    .select('client_slug, client_display_name, service_type, access_until, days_left, monthly_value')
    .order('access_until', { ascending: true })
    .limit(40);
  if (error) throw error;
  return (data ?? []) as ServiceRenewal[];
}

// ── Export CSV ───────────────────────────────────────────────────────────
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function exportSubscriptionsCsv(): Promise<Blob> {
  const { data } = await listSubscriptions({ limit: 1000, offset: 0 });
  const header = ['Aluno', 'Email', 'Plano', 'Valor mensal', 'Próxima cobrança', 'Forma de pagamento', 'Status', 'Início'];
  const rows = data.map((s) => [
    s.client_name,
    s.owner_email || '',
    s.plan_name,
    Number(s.monthly_value).toFixed(2).replace('.', ','),
    s.next_billing_date || '',
    s.payment_method_label || s.payment_method || '',
    s.status,
    s.started_at || '',
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(';')).join('\n');
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
}

export async function exportPurchasesCsv(): Promise<Blob> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('portal')
    .from('hotmart_purchases')
    .select(
      'transaction_code, buyer_email, offer_code, service_name, amount, status, payment_type, installments_total, installment_number, charged_at, client_slug',
    )
    .order('charged_at', { ascending: false })
    .limit(2000);
  if (error) throw error;

  const header = [
    'Código Transação',
    'Email Comprador',
    'Código Oferta',
    'Serviço',
    'Valor (R$)',
    'Status',
    'Tipo Pagamento',
    'Total Parcelas',
    'Nº Parcela',
    'Data Compra',
    'Aluno (slug)',
    'Vencimento',
  ];

  const rows = ((data ?? []) as PurchaseRow[]).map((p) => {
    const charged = p.charged_at ? new Date(p.charged_at) : null;
    const accessUntil = charged ? new Date(charged.getFullYear(), charged.getMonth() + 1, 18) : null;
    return [
      p.transaction_code,
      p.buyer_email,
      p.offer_code || '',
      canonicalServiceName(p.service_name || ''),
      Number(p.amount || 0).toFixed(2).replace('.', ','),
      p.status,
      p.payment_type || '',
      p.installments_total || 1,
      p.installment_number || 1,
      charged ? charged.toLocaleDateString('pt-BR') : '',
      p.client_slug || '',
      accessUntil ? accessUntil.toLocaleDateString('pt-BR') : '',
    ];
  });

  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(';')).join('\n');
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Financeiro manual (operacional) ────────────────────────────────────────
// Harmoniza com a Hotmart: registrar pagamento/adiantamento/acordo estende a MESMA
// régua (services.access_until) e chama o mesmo recálculo, via RPCs guardadas por is_admin.

export type ClientServiceRow = {
  id: string;
  service_type: string;
  status: string;
  access_until: string | null;
  monthly_value: number | null;
  billing_source: string;
  offer_code: string | null;
};

export async function listClientServices(clientSlug: string): Promise<ClientServiceRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('services')
    .select('id, service_type, status, access_until, monthly_value, billing_source, offer_code')
    .eq('client_slug', clientSlug)
    .neq('status', 'canceled')
    .order('service_type');
  if (error) throw error;
  return (data ?? []) as ClientServiceRow[];
}

export async function registerManualPayment(p: {
  client_slug: string;
  amount: number;
  method: string;
  paid_at: string;
  whole_plan?: boolean;
  service_ids?: string[];
  months?: number;
  new_access_until?: string | null;
  notes?: string | null;
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('register_manual_payment', {
    p_client_slug: p.client_slug,
    p_amount: Number(p.amount) || 0,
    p_method: p.method || null,
    p_paid_at: p.paid_at,
    p_whole_plan: p.whole_plan ?? true,
    p_service_ids: p.service_ids ?? [],
    p_months: p.months ?? 1,
    p_new_access_until: p.new_access_until || null,
    p_notes: p.notes || null,
  });
  if (error) throw error;
  return data;
}

export type AgreementInstallmentInput = { due_date: string; amount: number };

export async function createAgreement(p: {
  client_slug: string;
  title: string;
  notes?: string | null;
  installments: AgreementInstallmentInput[];
}): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('create_agreement', {
    p_client_slug: p.client_slug,
    p_title: p.title,
    p_notes: p.notes || null,
    p_installments: p.installments,
  });
  if (error) throw error;
  return data as string;
}

export async function settleInstallment(p: {
  installment_id: string;
  method: string;
  paid_at: string;
  extend?: boolean;
  whole_plan?: boolean;
  service_ids?: string[];
  months?: number;
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('settle_installment', {
    p_installment_id: p.installment_id,
    p_method: p.method || null,
    p_paid_at: p.paid_at,
    p_extend: p.extend ?? false,
    p_whole_plan: p.whole_plan ?? true,
    p_service_ids: p.service_ids ?? [],
    p_months: p.months ?? 1,
  });
  if (error) throw error;
  return data;
}

export async function setServiceBillingSource(
  serviceId: string,
  source: 'hotmart' | 'manual' | 'courtesy',
): Promise<true> {
  const supabase = createClient();
  const { error } = await supabase.rpc('set_service_billing_source', { p_service_id: serviceId, p_source: source });
  if (error) throw error;
  return true;
}

export type PaymentRow = {
  id: string;
  service_id: string | null;
  amount: number;
  method: string | null;
  paid_at: string;
  source: string;
  months: number;
  notes: string | null;
  created_at: string;
};

export async function listClientPayments(clientSlug: string, limit = 50): Promise<PaymentRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('payments')
    .select('id, service_id, amount, method, paid_at, source, months, notes, created_at')
    .eq('client_slug', clientSlug)
    .order('paid_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PaymentRow[];
}

export type AgreementInstallmentRow = {
  id: string;
  seq: number;
  due_date: string;
  amount: number;
  status: string;
  paid_at: string | null;
};
export type AgreementRow = {
  id: string;
  title: string;
  total_amount: number;
  status: string;
  notes: string | null;
  created_at: string;
  installments: AgreementInstallmentRow[];
};

export async function listClientAgreements(clientSlug: string): Promise<AgreementRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('payment_agreements')
    .select(
      'id, title, total_amount, status, notes, created_at, agreement_installments(id, seq, due_date, amount, status, paid_at)',
    )
    .eq('client_slug', clientSlug)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((a) => ({
    id: a.id as string,
    title: a.title as string,
    total_amount: Number(a.total_amount),
    status: a.status as string,
    notes: (a.notes as string) ?? null,
    created_at: a.created_at as string,
    installments: (((a.agreement_installments as Array<Record<string, unknown>>) ?? [])
      .map((i) => ({
        id: i.id as string,
        seq: i.seq as number,
        due_date: i.due_date as string,
        amount: Number(i.amount),
        status: i.status as string,
        paid_at: (i.paid_at as string) ?? null,
      }))
      .sort((x, y) => x.seq - y.seq)),
  }));
}
