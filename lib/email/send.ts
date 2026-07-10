import { SUPABASE_URL } from '@/lib/supabase/config';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Envio de e-mail a partir do servidor Next, delegando à Edge Function `send-email`
 * (que fala com o Resend e grava em portal.email_log). Só rode em Route Handlers —
 * usa a service role.
 *
 * A EF não aceita a service-role JWT como Bearer (o `SUPABASE_SERVICE_ROLE_KEY` que ela
 * lê do ambiente é a secret key nova, não esta JWT). Ela autentica pelo header
 * `x-internal-key`, cujo valor buscamos no Vault via RPC — assim não é preciso
 * duplicar mais um segredo nas env vars da Hostinger.
 */

let cachedInternalKey: string | null = null;

async function getInternalKey(): Promise<string> {
  if (cachedInternalKey) return cachedInternalKey;
  const { data, error } = await createAdminClient().rpc('get_internal_secret', {
    p_name: 'clickup_sync_internal_key',
  });
  if (error || !data) throw new Error('internal key indisponível: ' + (error?.message ?? 'vazia'));
  cachedInternalKey = String(data);
  return cachedInternalKey;
}

export async function sendTransactionalEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  const service = (process.env.SUPABASE_SERVICE_ROLE || '').trim();
  if (!service) return { ok: false, error: 'SUPABASE_SERVICE_ROLE ausente' };

  try {
    const internalKey = await getInternalKey();
    const r = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Bearer passa pelo gateway das Functions; x-internal-key autentica na função.
        Authorization: 'Bearer ' + service,
        'x-internal-key': internalKey,
      },
      body: JSON.stringify({ type: 'custom', to: opts.to, subject: opts.subject, html: opts.html }),
    });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return { ok: false, error: `send-email ${r.status}: ${JSON.stringify(body)}` };
    // A EF responde 200 com { failed } quando o provedor recusa o envio.
    if (body.failed) return { ok: false, error: String(body.failed) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
