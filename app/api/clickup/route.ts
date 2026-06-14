import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * app/api/clickup/route.ts — Proxy autenticado para a ClickUp API v2.
 *
 * Porte fiel de api/clickup.php, preservando os guards de segurança auditados:
 *  - Autenticação: valida a sessão Supabase (cookies → auth.getUser()).
 *  - Autorização: admin proxia qualquer slug; cliente precisa de slug + status
 *    approved; sem slug só admin passa.
 *  - Method allowlist: não-admin só GET/POST.
 *  - BOLA guard: o path precisa referenciar a própria task (cliente_task_id) ou
 *    list (cu_list_id) do cliente, resolvidos via service-role.
 *  - SSRF guard: rejeita path absoluto; força HTTPS; sem follow de redirect.
 */

const CLICKUP_BASE = 'https://api.clickup.com/api/v2';

type Json = Record<string, unknown>;

function jsonResponse(data: Json, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function POST(req: Request) {
  // ── Auth: sessão Supabase via cookies ───────────────────────────────────
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonResponse({ ok: false, error: 'Autenticação necessária.' }, 401);
  }

  // Perfil do portal (fonte de verdade de role/status/slug — não confia em metadata)
  const { data: profile } = await supabase
    .from('users')
    .select('role, status, client_slug')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  // Fail-safe: sessão sem perfil no portal não recebe acesso (evita escalonamento
  // por default 'approved' quando profile é null).
  if (!profile) {
    return jsonResponse({ ok: false, error: 'Perfil não encontrado para esta sessão.' }, 403);
  }

  const userRole = (profile.role as string) || 'client';
  const userStatus = (profile.status as string) || 'pending';
  const userClientSlug = (profile.client_slug as string) || '';

  // ── Parse body (JSON; multipart não suportado por este endpoint) ─────────
  let payload: Json = {};
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = (await req.json()) as Json;
    } catch {
      payload = {};
    }
  } else {
    try {
      const raw = await req.text();
      payload = raw ? (JSON.parse(raw) as Json) : {};
    } catch {
      payload = {};
    }
  }

  const clientSlug = String(payload.clientSlug ?? '').trim();

  // ── Authz ────────────────────────────────────────────────────────────────
  if (userRole === 'admin') {
    // Admin pode proxiar qualquer slug.
  } else if (clientSlug !== '') {
    if (userClientSlug !== '' && clientSlug !== userClientSlug) {
      return jsonResponse({ ok: false, error: 'Acesso negado a esse portal.' }, 403);
    }
    if (userStatus !== 'approved') {
      return jsonResponse({ ok: false, error: 'Sessão sem acesso ao ClickUp.' }, 403);
    }
  } else {
    // Sem slug → só admin.
    return jsonResponse({ ok: false, error: 'Sessão sem acesso ao ClickUp.' }, 403);
  }

  // ── Proxy ──────────────────────────────────────────────────────────────────
  const method = String(payload.method ?? 'GET').toUpperCase();
  const path = String(payload.path ?? '');

  if (path === '') {
    return jsonResponse({ ok: false, error: 'Path do ClickUp é obrigatório.' }, 422);
  }

  // CRITICAL-1: rejeita URLs absolutas (SSRF guard).
  if (/^https?:\/\//i.test(path)) {
    return jsonResponse(
      {
        ok: false,
        error: 'Path absoluto não é permitido. Use apenas caminhos relativos ao ClickUp.',
      },
      422,
    );
  }

  // FIX (HIGH — Finding #4 BOLA + Finding #7 method allowlist):
  // Restringe clientes a métodos seguros + scope ao próprio cliente_task_id/cu_list_id.
  if (userRole !== 'admin') {
    const allowedMethods = ['GET', 'POST'];
    if (!allowedMethods.includes(method)) {
      return jsonResponse({ ok: false, error: 'Método não permitido para esse portal.' }, 405);
    }

    // Resolve cliente_task_id e cu_list_id via service-role (ignora RLS).
    let allowedTaskId = '';
    let allowedListId = '';
    if (clientSlug !== '') {
      const admin = createAdminClient();
      const { data: rows } = await admin
        .from('clients')
        .select('cliente_task_id, cu_list_id')
        .eq('slug', clientSlug)
        .limit(1);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row) {
        allowedTaskId = String(row.cliente_task_id ?? '').trim();
        allowedListId = String(row.cu_list_id ?? '').trim();
      }
    }

    // BOLA guard com match ESTRITO de segmentos (evita que 'task/123' libere
    // 'task/12345...'). Segmenta o path ignorando query string.
    const pathClean = path.replace(/^\/+/, '');
    const seg = pathClean.split('?')[0].split('/');
    const isOwnTask = allowedTaskId !== '' && seg[0] === 'task' && seg[1] === allowedTaskId;
    const isOwnList = allowedListId !== '' && seg[0] === 'list' && seg[1] === allowedListId;

    if (!isOwnTask && !isOwnList) {
      return jsonResponse(
        { ok: false, error: 'Path fora do escopo permitido pra esse portal.' },
        403,
      );
    }
  }

  const apiKey = (process.env.CLICKUP_TOKEN || '').trim();
  if (apiKey === '') {
    return jsonResponse(
      { ok: false, error: 'API key do ClickUp não configurada no servidor.' },
      503,
    );
  }

  const targetUrl = CLICKUP_BASE + '/' + path.replace(/^\/+/, '');

  const headers: Record<string, string> = {
    Authorization: apiKey,
    'X-Requested-With': 'XMLHttpRequest',
  };

  const fetchInit: RequestInit = {
    method,
    headers,
    redirect: 'manual', // SSRF: sem follow de redirect
  };

  const body = payload.body ?? null;
  if (body !== null && body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchInit.body = typeof body === 'string' ? body : JSON.stringify(body);
  } else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    headers['Content-Length'] = '0';
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, fetchInit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ ok: false, error: 'Falha de conexão com o ClickUp: ' + msg }, 502);
  }

  const httpStatus = upstream.status;
  const respCT = upstream.headers.get('content-type') || 'application/json';
  const responseBody = await upstream.text();

  if (httpStatus === 401 || httpStatus === 403) {
    let details = '';
    try {
      const decoded = JSON.parse(responseBody) as Json;
      for (const key of ['err', 'error', 'message', 'ECODE']) {
        const value = String(decoded[key] ?? '').trim();
        if (value !== '') {
          details = value;
          break;
        }
      }
    } catch {
      /* corpo não-JSON */
    }
    let error =
      httpStatus === 401
        ? 'Credencial do ClickUp inválida ou expirada.'
        : 'Credencial do ClickUp sem acesso a esse workspace ou recurso.';
    if (details !== '') error += ' ' + details + '.';
    error += ' Atualize CLICKUP_TOKEN.';
    return jsonResponse({ ok: false, error, clickupStatus: httpStatus }, httpStatus);
  }

  return new NextResponse(responseBody, {
    status: httpStatus,
    headers: {
      'Content-Type': respCT,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function GET() {
  return jsonResponse({ ok: false, error: 'Método não permitido.' }, 405);
}
