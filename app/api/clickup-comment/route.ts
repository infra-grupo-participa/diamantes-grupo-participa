import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * app/api/clickup-comment/route.ts — Posta comentário do cliente como mensagem
 * na task do ClickUp vinculada a uma demanda.
 *
 * Porte fiel de api/clickup-comment.php:
 *   1. Valida sessão Supabase (cookies → auth.getUser()).
 *   2. role=user (somente clientes postam por aqui).
 *   3. Valida posse do slug e busca a demanda do cliente (service-role).
 *   4. Formata "Mensagem do cliente - {nome}\n\n{conteúdo}" + anexos.
 *   5. POST /task/{taskId}/comment no ClickUp.
 *   6. PATCH demands.clickup_synced_at.
 *
 * Body JSON: { demand_id, client_slug, content, attachments? }
 */

type Json = Record<string, unknown>;

function json(data: Json, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return json({ ok: false, error: 'Autenticação necessária.' }, 401);
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role, name, email, client_slug')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  const userRole = (profile?.role as string) || 'user';

  // Somente clientes postam comentários via este endpoint.
  if (userRole !== 'user') {
    return json({ ok: false, error: 'Endpoint exclusivo para clientes.' }, 403);
  }

  let payload: Json = {};
  try {
    payload = (await req.json()) as Json;
  } catch {
    payload = {};
  }

  const demandId = String(payload.demand_id ?? '').trim();
  const clientSlug = String(payload.client_slug ?? '').trim();
  const content = String(payload.content ?? '').trim();
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

  if (demandId === '' || clientSlug === '') {
    return json({ ok: false, error: 'demand_id e client_slug são obrigatórios.' }, 422);
  }

  // Valida posse do slug (perfil do portal vs. slug enviado).
  const profileSlug = (profile?.client_slug as string) || '';
  if (profileSlug !== '' && profileSlug !== clientSlug) {
    return json({ ok: false, error: 'Acesso negado a esse portal.' }, 403);
  }

  if (content === '' && attachments.length === 0) {
    return json({ ok: false, error: 'Mensagem vazia.' }, 422);
  }

  // Busca a demanda via service-role (ignora RLS e valida ownership).
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from('demands')
    .select('id, client_slug, clickup_task_id, title')
    .eq('id', demandId)
    .eq('client_slug', clientSlug)
    .limit(1);

  const demand = Array.isArray(rows) ? rows[0] : null;
  if (!demand) {
    return json({ ok: false, error: 'Demanda não encontrada ou não pertence ao cliente.' }, 404);
  }

  const clickupTaskId = String(demand.clickup_task_id ?? '').trim();

  if (clickupTaskId === '') {
    // Sem task vinculada: aceita silenciosamente (mensagem já gravada no DB pelo front).
    return json({ ok: true, synced: false, reason: 'demand_sem_clickup_task' });
  }

  // Nome do cliente (melhor esforço).
  let clientName = (profile?.name as string) || (profile?.email as string) || user.email || 'Cliente';
  clientName = String(clientName);

  // Formata comentário.
  let commentText = 'Mensagem do cliente - ' + clientName + '\n\n' + content;

  if (attachments.length > 0) {
    commentText += '\n\n*Anexos:*';
    for (const att of attachments) {
      const name =
        att && typeof att === 'object'
          ? String((att as Json).name ?? 'arquivo')
          : String(att);
      const url =
        att && typeof att === 'object' ? String((att as Json).signedUrl ?? '') : '';
      commentText += '\n- ' + name + (url !== '' ? ' → ' + url : '');
    }
  }

  const apiKey = (process.env.CLICKUP_TOKEN || '').trim();
  if (apiKey === '') {
    // Falha de config não deve bloquear o cliente — mensagem já está no DB.
    return json({ ok: true, synced: false, reason: 'API key do ClickUp não configurada.' });
  }

  // POST comment na task.
  const url = 'https://api.clickup.com/api/v2/task/' + encodeURIComponent(clickupTaskId) + '/comment';
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comment_text: commentText, notify_all: true }),
    });

    const respBody = await upstream.text();
    const code = upstream.status;

    if (code >= 400) {
      let msg = 'Erro ' + code;
      try {
        const decoded = JSON.parse(respBody) as Json;
        msg = String(decoded.err ?? decoded.error ?? decoded.message ?? msg);
      } catch {
        /* corpo não-JSON */
      }
      // Falha no ClickUp não bloqueia o cliente.
      return json({ ok: true, synced: false, reason: 'ClickUp retornou ' + code + ': ' + msg });
    }

    // PATCH demands.clickup_synced_at.
    await admin
      .from('demands')
      .update({ clickup_synced_at: new Date().toISOString() })
      .eq('id', demandId);

    let commentId: unknown = null;
    try {
      commentId = (JSON.parse(respBody) as Json).id ?? null;
    } catch {
      /* ignore */
    }

    return json({ ok: true, synced: true, clickup_comment_id: commentId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: true, synced: false, reason: 'Falha de conexão com ClickUp: ' + msg });
  }
}

export async function GET() {
  return json({ ok: false, error: 'Método não permitido.' }, 405);
}
