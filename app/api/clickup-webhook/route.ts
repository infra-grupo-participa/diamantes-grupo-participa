import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * app/api/clickup-webhook/route.ts — Recebe webhooks do ClickUp.
 *
 * Porte fiel de api/clickup-webhook.php:
 *   - Valida HMAC-SHA256 do raw body com CLICKUP_WEBHOOK_SECRET vs. header
 *     X-Signature (comparação timing-safe).
 *   - Replay protection: rejeita reqs > 5min (payload.date em epoch ms).
 *   - Hoje só ACK { ok, received }.
 */

type Json = Record<string, unknown>;

function jsonResponse(data: Json, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'X-Content-Type-Options': 'nosniff' },
  });
}

function getSecret(): string {
  return (
    process.env.CLICKUP_WEBHOOK_SECRET ||
    process.env.GP_CLICKUP_WEBHOOK_SECRET ||
    ''
  ).trim();
}

function signatureValid(rawBody: string, signature: string): boolean {
  const secret = getSecret();
  if (secret === '' || signature === '') return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signature.trim();
  // timingSafeEqual exige buffers de mesmo tamanho.
  const expBuf = Buffer.from(expected, 'utf8');
  const provBuf = Buffer.from(provided, 'utf8');
  if (expBuf.length !== provBuf.length) return false;
  return crypto.timingSafeEqual(expBuf, provBuf);
}

export async function POST(req: Request) {
  if (getSecret() === '') {
    return jsonResponse(
      { ok: false, error: 'CLICKUP_WEBHOOK_SECRET não configurado.' },
      503,
    );
  }

  const rawBody = await req.text();
  const signature = (req.headers.get('x-signature') || '').trim();

  if (!signatureValid(rawBody, signature)) {
    return jsonResponse({ ok: false, error: 'Assinatura inválida.' }, 401);
  }

  // Replay protection: ClickUp envia "date" (epoch ms). Rejeita reqs > 5min.
  let payload: Json | null = null;
  try {
    payload = JSON.parse(rawBody) as Json;
  } catch {
    payload = null;
  }
  const ts = payload && typeof payload.date !== 'undefined' ? Number(payload.date) : 0;
  if (Number.isFinite(ts) && ts > 0) {
    const tsSeconds = Math.floor(ts / 1000);
    const skew = Math.abs(Math.floor(Date.now() / 1000) - tsSeconds);
    if (skew > 300) {
      return jsonResponse(
        { ok: false, error: 'Timestamp fora da janela permitida (replay).' },
        401,
      );
    }
  }

  return jsonResponse({ ok: true, received: true });
}

export async function GET() {
  return jsonResponse({ ok: false, error: 'Método não permitido.' }, 405);
}
