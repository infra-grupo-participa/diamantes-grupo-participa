import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * app/api/briefing-to-clickup/route.ts — Recebe o PDF do briefing e cria/atualiza
 * uma task no ClickUp.
 *
 * Porte fiel de api/briefing-to-clickup.php:
 *   Modo projeto  — project_id + pdf + briefing_summary
 *     Sempre cria nova task na lista do cliente (clients.cu_list_id).
 *   Modo demanda  — demand_id + pdf + briefing_summary
 *     Reusa demands.clickup_task_id se existir; senão cria e salva de volta.
 *
 * Multipart: project_id XOR demand_id (UUID), pdf (<=20MB, application/pdf).
 * CORS travado no domínio de produção.
 */

const PROD_ORIGIN = 'https://diamantes.grupoparticipa.app.br';
const UUID_RE = /^[0-9a-f-]{36}$/i;

type Json = Record<string, unknown>;

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': PROD_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'X-Content-Type-Options': 'nosniff',
  };
}

function jsonOut(data: Json, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

async function cuCreateTask(
  listId: string,
  name: string,
  description: string,
  apiKey: string,
): Promise<{ taskId?: string; errorResponse?: NextResponse }> {
  let upstream: Response;
  try {
    upstream = await fetch(
      'https://api.clickup.com/api/v2/list/' + encodeURIComponent(listId) + '/task',
      {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description, notify_all: true }),
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      errorResponse: jsonOut(
        { ok: false, error: 'Erro ao criar task no ClickUp: ' + msg },
        502,
      ),
    };
  }

  const respText = await upstream.text();
  // ClickUp responde 201 ao criar a task — aceita qualquer 2xx, não só 200.
  if (!upstream.ok) {
    const detail = respText || 'sem detalhe';
    return {
      errorResponse: jsonOut(
        { ok: false, error: 'Erro ao criar task no ClickUp: ' + detail },
        502,
      ),
    };
  }

  let taskId = '';
  try {
    taskId = String((JSON.parse(respText) as Json).id ?? '');
  } catch {
    taskId = '';
  }
  if (taskId === '') {
    return {
      errorResponse: jsonOut(
        { ok: false, error: 'ClickUp não retornou ID da task criada.' },
        502,
      ),
    };
  }
  return { taskId };
}

export async function POST(req: Request) {
  const clickupKey = (process.env.CLICKUP_TOKEN || '').trim();
  if (clickupKey === '') {
    return jsonOut({ ok: false, error: 'Chave da API do ClickUp não configurada.' }, 500);
  }

  // ── Auth: sessão Supabase ────────────────────────────────────────────────
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonOut({ ok: false, error: 'JWT inválido ou expirado.' }, 401);
  }

  // ── Parse multipart ──────────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonOut({ ok: false, error: 'Payload multipart inválido.' }, 400);
  }

  const projectId = String(form.get('project_id') ?? '').trim();
  const demandId = String(form.get('demand_id') ?? '').trim();
  const isProject = projectId !== '' && UUID_RE.test(projectId);
  const isDemand = demandId !== '' && UUID_RE.test(demandId);

  // project_id XOR demand_id
  if (isProject === isDemand) {
    return jsonOut({ ok: false, error: 'project_id ou demand_id inválido.' }, 400);
  }

  // ── PDF ────────────────────────────────────────────────────────────────────
  const pdf = form.get('pdf');
  if (!(pdf instanceof File) || pdf.size === 0) {
    return jsonOut({ ok: false, error: 'Arquivo PDF ausente ou com erro.' }, 400);
  }
  if (pdf.size > 20 * 1024 * 1024) {
    return jsonOut({ ok: false, error: 'PDF muito grande (máx 20 MB).' }, 400);
  }

  const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
  // Valida assinatura real do arquivo (%PDF-) — não confia no MIME declarado.
  const isPdfMagic =
    pdfBytes.length >= 5 &&
    pdfBytes[0] === 0x25 && // %
    pdfBytes[1] === 0x50 && // P
    pdfBytes[2] === 0x44 && // D
    pdfBytes[3] === 0x46 && // F
    pdfBytes[4] === 0x2d; // -
  if (pdf.type !== 'application/pdf' || !isPdfMagic) {
    return jsonOut({ ok: false, error: 'Apenas arquivos PDF são aceitos.' }, 400);
  }

  // ── Caller (perfil do portal) ──────────────────────────────────────────────
  const admin = createAdminClient();
  const { data: callerRows } = await admin
    .from('users')
    .select('id, role, client_slug')
    .eq('auth_user_id', user.id)
    .limit(1);
  const caller = Array.isArray(callerRows) ? callerRows[0] : null;
  if (!caller) {
    return jsonOut({ ok: false, error: 'Usuário do portal não encontrado.' }, 403);
  }
  const isAdmin = caller.role === 'admin';

  // ── Resolve entidade ─────────────────────────────────────────────────────
  let entityTitle = '';
  let clientSlug = '';
  let existingTaskId = '';
  let entityTable: 'projects' | 'demands' = 'projects';
  let entityId = '';

  if (isProject) {
    const { data: rows } = await admin
      .from('projects')
      .select('id, title, client_slug')
      .eq('id', projectId)
      .limit(1);
    const entity = Array.isArray(rows) ? rows[0] : null;
    if (!entity) {
      return jsonOut({ ok: false, error: 'Projeto não encontrado.' }, 404);
    }
    if (!isAdmin && caller.client_slug !== entity.client_slug) {
      return jsonOut({ ok: false, error: 'Permissão negada.' }, 403);
    }
    entityTitle = String(entity.title ?? '');
    clientSlug = String(entity.client_slug ?? '');
    entityTable = 'projects';
    entityId = projectId;
    existingTaskId = ''; // projetos sempre criam task nova
  } else {
    const { data: rows } = await admin
      .from('demands')
      .select('id, title, client_slug, clickup_task_id')
      .eq('id', demandId)
      .limit(1);
    const entity = Array.isArray(rows) ? rows[0] : null;
    if (!entity) {
      return jsonOut({ ok: false, error: 'Demanda não encontrada.' }, 404);
    }
    if (!isAdmin && caller.client_slug !== entity.client_slug) {
      return jsonOut({ ok: false, error: 'Permissão negada.' }, 403);
    }
    entityTitle = String(entity.title ?? '');
    clientSlug = String(entity.client_slug ?? '');
    entityTable = 'demands';
    entityId = demandId;
    existingTaskId = String(entity.clickup_task_id ?? '').trim();
  }

  // ── Resolve lista do cliente ───────────────────────────────────────────────
  const { data: cRows } = await admin
    .from('clients')
    .select('cu_list_id')
    .eq('slug', clientSlug)
    .limit(1);
  const listId = String((Array.isArray(cRows) ? cRows[0]?.cu_list_id : '') ?? '').trim();
  if (listId === '') {
    return jsonOut(
      { ok: false, error: 'Cliente não possui lista do ClickUp configurada (cu_list_id).' },
      422,
    );
  }

  // ── Resolve task ID (cria se necessário) ───────────────────────────────────
  const briefingSummary = String(form.get('briefing_summary') ?? '').trim();
  let taskCreated = false;
  let taskId: string;

  if (existingTaskId !== '') {
    taskId = existingTaskId;
  } else {
    const taskName = 'Briefing — ' + entityTitle;
    const created = await cuCreateTask(listId, taskName, briefingSummary, clickupKey);
    if (created.errorResponse) return created.errorResponse;
    taskId = created.taskId as string;
    taskCreated = true;

    // Salva task ID na entidade para reutilização futura. Se a gravação falhar,
    // aborta: sem o vínculo persistido, uma reabertura criaria task duplicada.
    const { error: linkErr } = await admin
      .from(entityTable)
      .update({ clickup_task_id: taskId })
      .eq('id', entityId);
    if (linkErr) {
      return jsonOut(
        { ok: false, error: 'Task criada mas falhou ao salvar o vínculo: ' + linkErr.message },
        500,
      );
    }
  }

  // ── Anexa PDF à task ───────────────────────────────────────────────────────
  const safeTitle = entityTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = 'Briefing_' + safeTitle + '.pdf';

  const attachForm = new FormData();
  attachForm.append(
    'attachment',
    new Blob([pdfBytes], { type: 'application/pdf' }),
    fileName,
  );

  let attachOk = false;
  let attachText = '';
  let attachErr = '';
  try {
    const upstream = await fetch(
      'https://api.clickup.com/api/v2/task/' + encodeURIComponent(taskId) + '/attachment',
      {
        method: 'POST',
        redirect: 'manual',
        headers: { Authorization: clickupKey },
        body: attachForm,
      },
    );
    attachOk = upstream.ok; // aceita qualquer 2xx (ClickUp pode retornar 200/201)
    attachText = await upstream.text();
  } catch (e) {
    attachErr = e instanceof Error ? e.message : String(e);
  }

  if (!attachOk) {
    const detail = attachErr || attachText || 'sem detalhe';
    return jsonOut({ ok: false, error: 'Erro ao anexar PDF na task: ' + detail }, 502);
  }

  // ── Comentário de resumo (somente quando a task já existia) ────────────────
  if (!taskCreated && briefingSummary !== '') {
    try {
      await fetch(
        'https://api.clickup.com/api/v2/task/' + encodeURIComponent(taskId) + '/comment',
        {
          method: 'POST',
          redirect: 'manual',
          headers: { Authorization: clickupKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            comment_text:
              '📋 *Briefing de Abertura — ' + entityTitle + '*\n\n' + briefingSummary,
            notify_all: true,
          }),
        },
      );
    } catch {
      /* comentário é best-effort */
    }
  }

  return jsonOut({
    ok: true,
    task_created: taskCreated,
    clickup_url: 'https://app.clickup.com/t/' + taskId,
  });
}
