import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * app/api/hotmart-webhook/route.ts — Recebe webhooks da Hotmart.
 *
 * Porte fiel de api/hotmart-webhook.php:
 *   - Compara HOTMART_HOTTOK vs. header X-Hotmart-Hottok (timing-safe).
 *   - Eventos: PURCHASE_APPROVED/COMPLETE/CANCELED/REFUNDED/CHARGEBACK.
 *   - Normaliza payload Hotmart.
 *   - rpc process_hotmart_purchase (service-role).
 *   - Cancelamento: get_client_slug_by_email + cancel_client_service.
 *   - Compra: run_overdue_sync.
 */

type Json = Record<string, unknown>;

function jsonOut(data: Json, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'X-Content-Type-Options': 'nosniff' },
  });
}

function getHottokSecret(): string {
  return (process.env.HOTMART_HOTTOK || process.env.GP_HOTMART_WEBHOOK_SECRET || '').trim();
}

function signatureValid(hottok: string): boolean {
  const secret = getHottokSecret();
  if (secret === '' || hottok === '') return false;
  const a = Buffer.from(secret, 'utf8');
  const b = Buffer.from(hottok, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function asString(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function pick(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === 'object' && k in (cur as Json)) {
      cur = (cur as Json)[k];
    } else {
      return undefined;
    }
  }
  return cur;
}

export async function POST(req: Request) {
  if (getHottokSecret() === '') {
    return jsonOut({ ok: false, error: 'HOTMART_HOTTOK não configurado.' }, 503);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return jsonOut({ ok: false, error: 'Supabase não configurado.' }, 503);
  }

  const rawBody = await req.text();
  const hottok = (req.headers.get('x-hotmart-hottok') || '').trim();

  if (!signatureValid(hottok)) {
    return jsonOut({ ok: false, error: 'Assinatura inválida.' }, 401);
  }

  let payload: Json;
  try {
    payload = JSON.parse(rawBody) as Json;
  } catch {
    return jsonOut({ ok: false, error: 'Payload inválido.' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return jsonOut({ ok: false, error: 'Payload inválido.' }, 400);
  }

  const event = asString(payload.event).toUpperCase();

  const relevant = [
    'PURCHASE_APPROVED',
    'PURCHASE_COMPLETE',
    'PURCHASE_CANCELED',
    'PURCHASE_REFUNDED',
    'PURCHASE_CHARGEBACK',
  ];
  if (!relevant.includes(event)) {
    // Evento irrelevante — 200 para a Hotmart não retentar.
    return jsonOut({ ok: true, skipped: true, event });
  }

  const data = (payload.data as Json) ?? {};

  const txCode = asString(pick(data, 'purchase', 'transaction'));
  const buyerEmail = asString(pick(data, 'buyer', 'email')).trim().toLowerCase();
  const offerCode = asString(pick(data, 'purchase', 'offer', 'code'));
  const serviceName = asString(pick(data, 'purchase', 'offer', 'name'));
  const amount = Number(pick(data, 'purchase', 'price', 'value') ?? 0) || 0;
  const paymentType = asString(pick(data, 'purchase', 'payment', 'type'));
  const installTotal = Number(pick(data, 'purchase', 'payment', 'installments_number') ?? 1) || 1;
  // Índice da recorrência da assinatura (1ª, 2ª cobrança…). A Hotmart envia em
  // purchase.recurrence_number; fallback 1 quando ausente (compra avulsa / 1ª cobrança).
  // NUNCA usar subscriber_code (string identificadora da assinatura) — ele já fica
  // preservado integralmente em p_raw_payload.
  const installNum = Number(pick(data, 'purchase', 'recurrence_number') ?? 1) || 1;
  const chargedAtRaw = asString(pick(data, 'purchase', 'approved_date'));

  // Hotmart envia datas em epoch ms.
  let chargedAt = 'now()';
  if (chargedAtRaw !== '' && /^\d+$/.test(chargedAtRaw) && Number(chargedAtRaw) > 0) {
    chargedAt = new Date(Number(chargedAtRaw)).toISOString();
  } else if (chargedAtRaw !== '') {
    chargedAt = chargedAtRaw;
  }

  const statusMap: Record<string, string> = {
    PURCHASE_APPROVED: 'approved',
    PURCHASE_COMPLETE: 'complete',
    PURCHASE_CANCELED: 'canceled',
    PURCHASE_REFUNDED: 'refunded',
    PURCHASE_CHARGEBACK: 'chargeback',
  };
  const status = statusMap[event] ?? 'other';

  if (txCode === '' || buyerEmail === '') {
    return jsonOut(
      { ok: false, error: 'Campos obrigatórios ausentes (transaction/email).' },
      422,
    );
  }

  const admin = createAdminClient();
  const isCancellation = ['canceled', 'refunded', 'chargeback'].includes(status);

  const purchaseParams = {
    p_transaction_code: txCode,
    p_buyer_email: buyerEmail,
    p_offer_code: offerCode,
    p_service_name: serviceName,
    p_amount: amount,
    p_status: status,
    p_payment_type: paymentType,
    p_installments_total: installTotal,
    p_installment_number: installNum,
    p_charged_at: chargedAt,
    p_raw_payload: payload,
  };

  if (isCancellation) {
    // Grava o evento de cancelamento no histórico.
    const { error: cancelInsertErr } = await admin.rpc('process_hotmart_purchase', purchaseParams);
    if (cancelInsertErr) {
      // Retorna erro p/ a Hotmart reenviar — não engole o cancelamento/refund.
      return jsonOut({ ok: false, error: 'Erro ao gravar cancelamento.', detail: cancelInsertErr.message }, 500);
    }

    // Resolve client_slug pelo email.
    const { data: slugData } = await admin.rpc('get_client_slug_by_email', {
      p_email: buyerEmail,
    });
    let clientSlug: string | null = null;
    if (Array.isArray(slugData)) {
      clientSlug = slugData[0] ?? null;
    } else if (slugData) {
      clientSlug = String(slugData);
    }

    if (clientSlug && offerCode !== '') {
      const { data: cancelData, error: cancelError } = await admin.rpc('cancel_client_service', {
        p_client_slug: clientSlug,
        p_offer_code: offerCode,
      });
      if (cancelError) {
        return jsonOut(
          { ok: false, error: 'Erro ao cancelar serviço.', detail: cancelError.message },
          500,
        );
      }
      return jsonOut({ ok: true, event, result: cancelData });
    }

    return jsonOut({ ok: true, event, matched: false, note: 'cliente nao identificado' });
  }

  // Compra.
  const { data: rpcData, error: rpcError } = await admin.rpc(
    'process_hotmart_purchase',
    purchaseParams,
  );

  if (rpcError) {
    return jsonOut({ ok: false, error: 'Erro ao gravar no banco.', detail: rpcError.message }, 500);
  }

  // Atualiza status overdue/paid após cada compra processada (best-effort).
  const { error: syncErr } = await admin.rpc('run_overdue_sync', {});
  if (syncErr) {
    console.warn('[hotmart-webhook] run_overdue_sync falhou:', syncErr.message);
  }

  return jsonOut({ ok: true, event, result: rpcData });
}

export async function GET() {
  return jsonOut({ ok: false, error: 'Método não permitido.' }, 405);
}
