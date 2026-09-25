// clickup-webhook v5 — sync reversa: task updates + comentários + assignees.
// ClickUp → (webhook) → esta função → portal.demands / portal.demand_messages.
//
// v3 (migration 086): ramo taskAssigneeUpdated ANTES do bloco genérico de task field
// updates. Compara demand_operators (via operators.clickup_user_id) com task.assignees
// e grava clickup_assignee_sync='external' + detail antes/depois quando diverge (e volta
// para 'ok' quando converge). NÃO escreve em demand_operators — o webhook só OBSERVA e
// REGISTRA; o admin decide pelo painel via portal.admin_resolve_assignee_divergence
// (decisão do Marcio). Também dispara e-mail ao admin (send-email type
// 'divergencia_assignee', context:'webhook') quando a divergência é NOVA (não reenvia se
// já estava 'external' e continua 'external' com o mesmo conjunto de assignees).
//
// 'external' é DIFERENTE de 'partial'/'partial_expected'/'none' (populados pelo
// clickup-sync na saída portal→ClickUp, ver esse arquivo para o caso GUEST): aqui é
// sempre uma mudança feita DIRETO no ClickUp, fora do fluxo do portal.
//
// ⚠️ Este evento só chega se o webhook estiver REGISTRADO com taskAssigneeUpdated na
// lista de eventos (webhook_id em portal.clickup_config). Escutar no código não faz o
// ClickUp enviar — é preciso re-registrar via API e confirmar.
//
// v4 (086/087, revisão do arquiteto 2026-09-03 — ANTES de qualquer deploy real):
//   - handleAssigneeUpdated agora respeita clickup_config.assignee_strategy='legacy':
//     antes só o clickup-sync lia essa chave — em modo legacy o webhook continuava
//     gravando 'external' e mandando e-mail, o que é reversão INCOMPLETA (o admin liga
//     'legacy' esperando desligar a feature toda, não só metade dela).
//   - notifyAdminDivergence extraída para _shared/notify-admin-divergence.ts (estava
//     duplicada literalmente em clickup-sync) — também respeita agora
//     assignee_alert_email='off'.
//   - stripBotPrefix e a remoção do prefixo "[Projeto] " no nome da task: taskName()
//     no clickup-sync não põe mais esse prefixo desde a v10 (hierarquia pasta→lista
//     tornou o prefixo redundante). O código aqui é compat para tasks CRIADAS ANTES
//     da v10 que ainda tenham o prefixo no nome — documentado, não removido (task
//     antiga com prefixo residual continuaria sincronizando o nome errado se
//     removêssemos sem mais checagem).
//
// v5 (089/090/091, 2026-09-24 — plano definitivo de atribuição de responsáveis):
//   - SPLIT de 'external' em três estados, porque o rótulo único misturava PERDA de
//     responsável (alguém removido no ClickUp — acionável, dói) com TROCA deliberada
//     feita pela equipe lá (o normal do dia a dia). Medição de 24/09: 12 demandas
//     'external', só 4 eram perda real — 8 alertas de e-mail eram ruído puro.
//       external_loss       missing>0 && extra==0  → entra na fila + ALERTA por e-mail
//       external_reassigned missing>0 && extra>0   → só registra (troca deliberada)
//       external_added      missing==0 && extra>0  → só registra (reforço de equipe)
//     `detail` agora leva missing_names/extra_names além de before/after — sem isso o
//     painel não consegue dizer QUEM saiu e QUEM entrou, só que "divergiu".
//   - RECONCILIAÇÃO AUTOMÁTICA member→member (decisão 4 do Marcio, 24/09): quando a
//     troca no ClickUp é 100% entre operadores CADASTRADOS e ATIVOS, e nenhum lado é
//     guest, o portal aplica sozinho via portal.apply_clickup_assignees (migration
//     091) em vez de deixar na fila do admin. "O ClickUp manda" — é o que se fazia à
//     mão. Fora desse escopo estrito, cai no split acima e o admin decide.
//     🔴 Este é o ÚNICO caminho automático que escreve em demand_operators a partir
//     de fonte externa (reabre o caminho do bug destrutivo de 03/09). A validação
//     mora DENTRO da RPC, em transação: valida TODOS os ids ANTES de qualquer DELETE.
//     Aqui em cima há uma 2ª barreira (elegibilidade), mas a barreira que vale é a da
//     RPC — o webhook não é fonte de confiança.
//   - last_synced_from_clickup_at carimbado nos DOIS UPDATEs deste ramo (passo 6 do
//     plano): antes só taskDeleted/field-update carimbavam, e as demandas 'external'
//     ficavam com NULL para sempre — impossível saber quando o ClickUp foi lido.
//
// ⚠️ Fonte da verdade vive no Supabase (deploy via `supabase functions deploy`).
// Este arquivo é a cópia versionada — mantenha em sincronia ao editar a função.
//
// ✅ DIFF CONTRA O REMOTO FEITO EM 2026-09-24: a v4 em produção foi baixada e
// conferida idêntica a esta cópia do repo antes da edição da v5. O aviso "NÃO FAÇA
// DEPLOY sem diffar" que vivia aqui desde 03/09 foi removido por estar cumprido —
// ver supabase/functions/README.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyAdminDivergence as notifyAdminDivergenceShared } from "../_shared/notify-admin-divergence.ts";

const CLICKUP_API  = "https://api.clickup.com/api/v2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function mapStatusReverse(s: string): string | null {
  const lower = (s || "").toLowerCase();
  switch (lower) {
    case "aberta":         return "open";
    case "em andamento":   return "in_progress";
    case "em revisão":
    case "em revisao":     return "review";
    case "concluída":
    case "concluida":      return "done";
    case "cancelado":
    case "cancelada":      return "canceled";
  }
  return null;
}

async function getSecret(supabase: any, name: string): Promise<string> {
  const { data, error } = await supabase.schema("portal")
    .rpc("get_internal_secret", { p_name: name });
  if (error) throw new Error(`secret ${name}: ${error.message}`);
  return data || "";
}

// v4: o webhook passou a precisar de clickup_config (assignee_strategy,
// assignee_alert_email) — antes só o clickup-sync lia essa tabela.
async function getConfig(supabase: any) {
  const { data, error } = await supabase.schema("portal").from("clickup_config").select("key, value");
  if (error) throw new Error("Config: " + error.message);
  return Object.fromEntries((data || []).map((r: any) => [r.key, r.value]));
}

async function verifyHmac(payload: string, signature: string, secret: string): Promise<boolean> {
  if (!secret || !signature) return false;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (hex.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  } catch (e) { console.error("verifyHmac err", e); return false; }
}

async function fetchTaskFromClickUp(apiKey: string, taskId: string): Promise<any> {
  const r = await fetch(`${CLICKUP_API}/task/${taskId}`, { headers: { "Authorization": apiKey } });
  if (!r.ok) throw new Error(`ClickUp GET task ${r.status}`);
  return r.json();
}

async function fetchCommentsFromClickUp(apiKey: string, taskId: string): Promise<any[]> {
  const r = await fetch(`${CLICKUP_API}/task/${taskId}/comment?start=0`, { headers: { "Authorization": apiKey } });
  if (!r.ok) throw new Error(`ClickUp GET comments ${r.status}`);
  const j = await r.json();
  return j.comments || [];
}

async function findUserForClickUpUser(supabase: any, cuUser: any): Promise<{ id: string; name: string; role: string } | null> {
  if (!cuUser) return null;
  const id = cuUser.id ? Number(cuUser.id) : null;
  if (id) {
    const { data } = await supabase.schema("portal").from("users")
      .select("id, name, role").eq("clickup_user_id", id).maybeSingle();
    if (data) return data;
  }
  if (cuUser.email) {
    const { data } = await supabase.schema("portal").from("users")
      .select("id, name, role").eq("email", cuUser.email.toLowerCase()).maybeSingle();
    if (data) return data;
  }
  return null;
}

// Alerta de divergência ao admin (extraído para _shared — estava duplicado
// literalmente em clickup-sync, ver migration 086/087 revisão 2026-09-03).
async function notifyAdminDivergence(supabase: any, cfg: any, demand_id: string, before: string[], after: string[]) {
  // context:'webhook' → send-email usa o rótulo "portal esperava/ClickUp tem"
  // (mudança feita direto no ClickUp, fora do portal — estado 'external').
  await notifyAdminDivergenceShared(supabase, SUPABASE_URL, getSecret, cfg, demand_id, "webhook", before, after);
}

// Classifica a divergência a partir das duas contagens. Um rótulo só para os três
// casos era o bug de desenho do plano (passo 2): 8 das 12 demandas 'external' de
// 24/09 eram troca/reforço deliberado da equipe, não perda.
//   external_loss       = sumiu gente e não entrou ninguém → o portal esperava alguém
//                          que o ClickUp não tem mais. É o único ACIONÁVEL (fila +
//                          e-mail): responsável removido é trabalho sem dono.
//   external_reassigned = sumiu gente E entrou gente → troca deliberada no ClickUp.
//   external_added      = só entrou gente → reforço. Ninguém perdeu nada.
// Só 'external_loss' entra no índice parcial idx_demands_assignee_pending (089) e em
// PENDING_ASSIGNEE_STATES (lib/api/admin-demandas.ts) — as três pontas têm que casar
// caractere a caractere, senão o planner troca Index Scan por Seq Scan em silêncio.
function classifyExternal(missingCount: number, extraCount: number): string {
  if (missingCount > 0 && extraCount === 0) return "external_loss";
  if (missingCount > 0 && extraCount > 0) return "external_reassigned";
  return "external_added"; // missing==0 && extra>0 (o chamador só entra aqui se divergiu)
}

// Lê o cache de guests do workspace (clickup_config.guest_clickup_ids_cache), mantido
// por clickup-sync#getTeamRoles a partir do GET /team. Devolve null quando o cache não
// dá para confiar (ausente, vazio, corrompido) — e null aqui significa NÃO AUTO-APLICAR.
//
// ⚠️ O webhook NÃO revalida esse cache (não vai buscar o /team): revalidar aqui
// significaria uma chamada extra ao ClickUp em todo evento de assignee, e o dono da
// revalidação é o clickup-sync. Cache frio = auto-reconciliação desligada nesse
// evento, e a demanda cai no split (o admin decide). Degradar para o caminho manual é
// sempre seguro; o contrário não.
function guestIdsFromCache(cfg: any): Set<number> | null {
  const raw = cfg?.guest_clickup_ids_cache || "";
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw);
    if (!cached || !Array.isArray(cached.ids)) return null;
    // Set vazio ≠ "não há guests": pode ser um /team que falhou e gravou lista vazia.
    // Sabemos que HÁ guests neste workspace (3 em 24/09) — lista vazia é suspeita,
    // então tratamos como cache inutilizável em vez de "ninguém é guest".
    if (cached.ids.length === 0) return null;
    return new Set<number>(cached.ids.map((n: any) => Number(n)).filter((n: number) => !isNaN(n)));
  } catch (_) {
    return null;
  }
}

// ===== taskAssigneeUpdated =====
// Compara demand_operators (esperado, via operators.clickup_user_id) com os
// assignees reais da task (ClickUp).
//
// v4: respeita clickup_config.assignee_strategy='legacy' — em modo legacy, o
// webhook não compara nem grava nada (reversão completa; antes só o
// clickup-sync respeitava essa chave).
//
// v5: dois caminhos, nesta ordem.
//   (1) ELEGÍVEL para auto-reconciliação member→member (decisão 4 do Marcio): chama
//       portal.apply_clickup_assignees e o banco passa a refletir o ClickUp.
//   (2) Qualquer outro caso: só CLASSIFICA (external_loss/reassigned/added) e deixa
//       para o admin resolver pelo painel, como sempre foi.
// O caminho (1) é a única escrita automática em demand_operators a partir do ClickUp
// que existe no sistema. Tudo que não couber com folga no escopo estrito vai para (2).
async function handleAssigneeUpdated(supabase: any, apiKey: string, cfg: any, demand: any) {
  if (cfg?.assignee_strategy === "legacy") {
    return { skipped: "legacy_strategy" };
  }
  const { data: dops } = await supabase.schema("portal")
    .from("demand_operators").select("operator_id").eq("demand_id", demand.id);
  const opIds = (dops || []).map((d: any) => d.operator_id);
  let expectedOps: Array<{ clickup_user_id: number | null; name: string | null }> = [];
  if (opIds.length) {
    const { data: ops } = await supabase.schema("portal")
      .from("operators").select("clickup_user_id, name").in("id", opIds);
    expectedOps = ops || [];
  }
  const expected = new Set(
    expectedOps.map((o) => (o.clickup_user_id ? Number(o.clickup_user_id) : null)).filter((n): n is number => n !== null && !isNaN(n)),
  );

  const task = await fetchTaskFromClickUp(apiKey, demand.clickup_task_id);
  const currentAssignees: Array<{ id: number; name: string }> = (task?.assignees || [])
    .map((a: any) => ({ id: Number(a.id), name: a.username || a.email || String(a.id) }))
    .filter((a: any) => !isNaN(a.id));
  const current = new Set(currentAssignees.map((a) => a.id));

  const missing = [...expected].filter((id) => !current.has(id));
  const extra = [...current].filter((id) => !expected.has(id));
  const diverged = missing.length > 0 || extra.length > 0;

  const { data: prevDemand } = await supabase.schema("portal")
    .from("demands").select("clickup_assignee_sync").eq("id", demand.id).maybeSingle();
  // v5: wasExternal cobre os três estados do split — com o `=== "external"` antigo,
  // uma demanda que já estava external_loss e recebesse outro evento de perda seria
  // tratada como divergência NOVA e mandaria e-mail de novo a cada evento.
  const prevSync: string = prevDemand?.clickup_assignee_sync || "";
  const wasExternal = prevSync.startsWith("external");

  const nowIso = new Date().toISOString();
  const beforeNames = expectedOps.map((o) => o.name).filter(Boolean) as string[];
  const afterPayload = currentAssignees.map((a) => ({ id: String(a.id), name: a.name }));
  const afterNames = currentAssignees.map((a) => a.name);
  // Nomes dos que SAÍRAM (esperados pelo portal, ausentes no ClickUp) e dos que
  // ENTRARAM (estão no ClickUp, o portal não conhece nesta demanda). Sem isso o painel
  // só sabe que divergiu, não quem saiu nem quem entrou.
  const missingNames = expectedOps
    .filter((o) => o.clickup_user_id !== null && missing.includes(Number(o.clickup_user_id)))
    .map((o) => o.name)
    .filter(Boolean) as string[];
  const extraNames = currentAssignees.filter((a) => extra.includes(a.id)).map((a) => a.name);

  if (!diverged) {
    await supabase.schema("portal").from("demands")
      .update({
        clickup_assignee_sync: "ok",
        clickup_assignee_detail: {},
        last_synced_from_clickup_at: nowIso, // passo 6
      }).eq("id", demand.id);
    return { converged: true };
  }

  // ── Caminho (1): auto-reconciliação member→member ─────────────────────────
  const auto = await tryAutoReconcile(supabase, cfg, demand.id, missing, extra, currentAssignees);
  if (auto.applied) {
    // A RPC já gravou demands (sync='ok', detail={}), demand_operators e audit_log
    // numa transação só. Aqui sobra o carimbo de leitura do ClickUp.
    await supabase.schema("portal").from("demands")
      .update({ last_synced_from_clickup_at: nowIso }).eq("id", demand.id);
    return { auto_reconciled: true, applied: auto.applied_count ?? null };
  }

  // ── Caminho (2): só classifica ────────────────────────────────────────────
  const syncState = classifyExternal(missing.length, extra.length);

  await supabase.schema("portal").from("demands").update({
    clickup_assignee_sync: syncState,
    clickup_assignee_detail: {
      before: beforeNames,
      after: afterPayload,
      missing_names: missingNames,
      extra_names: extraNames,
    },
    last_synced_from_clickup_at: nowIso, // passo 6
  }).eq("id", demand.id);

  await supabase.schema("portal").from("audit_log").insert({
    event: "demand_assignee_divergence_detected",
    user_id: null,
    identifier: demand.id,
    metadata: {
      before: beforeNames, after: afterNames,
      missing_count: missing.length, extra_count: extra.length,
      missing_names: missingNames, extra_names: extraNames,
      sync_state: syncState,
      auto_reconcile_skipped: auto.reason,
    },
  });

  // E-mail SÓ em external_loss (passo 2): reassigned/added são trabalho normal da
  // equipe no ClickUp — alertar neles é o ruído que fez 165 e-mails/30 dias com 0
  // divergências resolvidas. E só na divergência NOVA (não reenvia a cada evento).
  if (syncState === "external_loss" && !wasExternal) {
    await notifyAdminDivergence(supabase, cfg, demand.id, beforeNames, afterNames);
  }
  return {
    diverged: true, sync: syncState,
    missing: missing.length, extra: extra.length,
    auto_reconcile_skipped: auto.reason,
  };
}

// Decide se a divergência cabe no escopo ESTRITO da decisão 4 do Marcio e, se couber,
// chama a RPC que aplica. Devolve {applied:false, reason} em todo caso não elegível —
// o chamador então segue pelo caminho de classificação.
//
// Elegível quando TODAS as condições valem:
//   a) há pelo menos um `extra` (alguém novo no ClickUp). Só-perda (external_loss)
//      NUNCA é auto-aplicada: aplicar sozinho uma remoção é o caminho do apagão de
//      03/09 — demanda ficaria sem responsável nenhum sem ninguém decidir isso.
//   b) TODO `extra` casa com um operators ATIVO e com clickup_user_id cadastrado.
//      Um único ID sem cadastro (ex. Ramon 234063256 antes do cadastro, ou um ID
//      fantasma) desqualifica o lote inteiro.
//   c) NENHUM lado (missing ou extra) é guest. Guest não pode ser assignee, então a
//      "ausência" dele no ClickUp não é decisão de ninguém — é limitação. Aplicar
//      apagaria o vínculo de um guest legítimo do banco.
//   d) o cache de guests é confiável (ver guestIdsFromCache) — sem ele não dá para
//      afirmar (c), e na dúvida NÃO se escreve.
async function tryAutoReconcile(
  supabase: any, cfg: any, demandId: string,
  missing: number[], extra: number[],
  currentAssignees: Array<{ id: number; name: string }>,
): Promise<{ applied: boolean; reason?: string; applied_count?: number }> {
  if (extra.length === 0) return { applied: false, reason: "no_extra_assignee" };

  const guestIds = guestIdsFromCache(cfg);
  if (guestIds === null) return { applied: false, reason: "guest_cache_unusable" };
  if (missing.some((id) => guestIds.has(id))) return { applied: false, reason: "missing_is_guest" };
  if (extra.some((id) => guestIds.has(id))) return { applied: false, reason: "extra_is_guest" };

  // Todos os extras precisam ser operador ativo cadastrado. Esta é a checagem de
  // ELEGIBILIDADE — a checagem que VALE (e que impede o DELETE) é a de dentro da RPC,
  // em transação. Aqui é só para não chamar a RPC sabendo que ela vai dar RAISE.
  //
  // ⚠️ operators.clickup_user_id é TEXT (migration 016), não numérico — o `.in()` vai
  // com strings, senão a comparação depende de coerção implícita do PostgREST. Mesma
  // convenção do `o.clickup_user_id::text = ANY(...)` da 086.
  const extraAsText = extra.map((id) => String(id));
  const { data: matched, error: matchErr } = await supabase.schema("portal")
    .from("operators").select("id, clickup_user_id")
    .in("clickup_user_id", extraAsText)
    .eq("status", "active");
  if (matchErr) {
    console.error("tryAutoReconcile match err", demandId, matchErr.message);
    return { applied: false, reason: "operator_lookup_failed" };
  }
  const matchedIds = new Set(
    (matched || []).map((o: any) => Number(o.clickup_user_id)).filter((n: number) => !isNaN(n)),
  );
  if (extra.some((id) => !matchedIds.has(id))) {
    return { applied: false, reason: "extra_not_registered_operator" };
  }

  // Aplica o estado do ClickUp inteiro (todos os assignees atuais da task), não só os
  // extras: a RPC faz INSERT dos novos + DELETE dos ausentes numa transação, sempre
  // validando antes. Passar só os extras deixaria os removidos no banco.
  const allClickupIds = currentAssignees.map((a) => a.id);
  const { data, error } = await supabase.schema("portal")
    .rpc("apply_clickup_assignees", { p_demand_id: demandId, p_clickup_user_ids: allClickupIds });
  if (error) {
    // RAISE da RPC (validação reprovou) ou erro de transporte: NÃO aplicou nada —
    // a RPC é all-or-nothing. Cai no caminho de classificação, que é o comportamento
    // correto: o admin decide.
    console.error("apply_clickup_assignees falhou — caindo para classificação", demandId, error.message);
    return { applied: false, reason: "rpc_error:" + (error.message || "").slice(0, 120) };
  }
  return { applied: true, applied_count: (data as any)?.operators_applied ?? null };
}

function stripBotPrefix(text: string): string {
  // Mensagens postadas pelo nosso bot vêm com '**Nome** (papel):\n...'
  // Detectamos e removemos pra evitar duplicidade visual.
  const m = text.match(/^\*\*[^*]+\*\* \((cliente|operador|admin)\):\n([\s\S]*)$/);
  return m ? m[2] : text;
}

async function handleCommentEvent(supabase: any, apiKey: string, payload: any, demand: any, event: string) {
  // payload geralmente traz history_items com o comentário. Mas pra ser robusto,
  // refetcho a lista de comentários e pego o mais recente que ainda não exista.
  const items = (payload?.history_items || []);
  const commentMeta = items.find((h: any) => h.type === 4 || (h.field && h.field.toLowerCase().includes("comment"))) || items[0];
  const userMeta = commentMeta?.user || payload?.user || null;

  const comments = await fetchCommentsFromClickUp(apiKey, demand.clickup_task_id);
  if (comments.length === 0) return { skipped: "no_comments" };

  // Pega comentários que ainda não existem no Supabase
  const cuIds = comments.map((c: any) => String(c.id));
  const { data: existingRows } = await supabase.schema("portal")
    .from("demand_messages")
    .select("clickup_comment_id")
    .in("clickup_comment_id", cuIds);
  const existing = new Set((existingRows || []).map((r: any) => r.clickup_comment_id));

  const toInsert: any[] = [];
  for (const c of comments) {
    const cid = String(c.id);
    if (existing.has(cid)) continue;
    const text = stripBotPrefix(c.comment_text || c.comment || "");
    if (!text.trim()) continue;
    const cuUser = c.user || userMeta || {};
    const author = await findUserForClickUpUser(supabase, cuUser);
    // Autores sem vínculo de operador (pessoas de fora da equipe respondendo na task)
    // entram com user_id null + o nome de exibição vindo do ClickUp (clickup_author).
    toInsert.push({
      demand_id: demand.id,
      user_id: author?.id ?? null,
      clickup_author: author ? null : (cuUser.username || cuUser.email || "Equipe"),
      content: text.trim(),
      origin: "clickup",
      clickup_comment_id: cid,
      created_at: c.date ? new Date(Number(c.date)).toISOString() : new Date().toISOString(),
    });
  }

  if (toInsert.length === 0) return { skipped: "all_already_synced" };

  const { error } = await supabase.schema("portal")
    .from("demand_messages").insert(toInsert);
  // 23505 = unique_violation no índice demand_messages_clickup_comment_id_key:
  // uma corrida (clickup-comment-sync ainda persistindo o cid) já inseriu este
  // comentário. Não é erro — ignora para não gerar 500/retry e sem duplicar.
  if (error && (error as { code?: string }).code === "23505") {
    return { deduped: toInsert.length };
  }
  if (error) throw new Error("insert err: " + error.message);
  return { inserted: toInsert.length };
}

Deno.serve(async (req: Request) => {
  try {
    const rawBody = await req.text();
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const sig = req.headers.get("x-signature") || req.headers.get("X-Signature") || "";
    let webhookSecret = "";
    try { webhookSecret = await getSecret(supabase, "clickup_webhook_secret"); } catch (_) {}
    // Falha FECHADA: sem secret configurado/legível, não há como verificar a
    // origem do payload — recusa em vez de aceitar qualquer requisição.
    if (!webhookSecret) {
      console.error("clickup_webhook_secret ausente — recusando (fail-closed)");
      return new Response(JSON.stringify({ error: "webhook secret not configured" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const valid = await verifyHmac(rawBody, sig, webhookSecret);
    if (!valid) {
      console.warn("HMAC inválido. sig=", sig.slice(0, 16));
      return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    let payload: any = {};
    try { payload = JSON.parse(rawBody); } catch (_) {
      return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const event   = payload.event || "";
    const taskId  = payload.task_id || payload.taskId || "";
    if (!taskId) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_task_id" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const { data: demand } = await supabase.schema("portal")
      .from("demands").select("id, status, title, description, starts_at, ends_at, clickup_task_id, finalized_at")
      .eq("clickup_task_id", taskId).maybeSingle();
    if (!demand) {
      return new Response(JSON.stringify({ ok: true, skipped: "unknown_task", task_id: taskId }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ===== Assignee events (migration 086) — ANTES do bloco genérico de task
    // field updates: só observa/registra, nunca escreve em demand_operators. =====
    if (event === "taskAssigneeUpdated") {
      const apiKey = await getSecret(supabase, "clickup_api_key");
      const cfg = await getConfig(supabase);
      const res = await handleAssigneeUpdated(supabase, apiKey, cfg, demand);
      return new Response(JSON.stringify({ ok: true, event, demand_id: demand.id, ...res }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ===== Comment events =====
    if (event === "taskCommentPosted" || event === "taskCommentUpdated") {
      const apiKey = await getSecret(supabase, "clickup_api_key");
      const res = await handleCommentEvent(supabase, apiKey, payload, demand, event);
      return new Response(JSON.stringify({ ok: true, event, demand_id: demand.id, ...res }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // taskDeleted
    if (event === "taskDeleted") {
      await supabase.schema("portal").from("demands").update({
        status: "canceled",
        last_synced_from_clickup_at: new Date().toISOString(),
      }).eq("id", demand.id);
      return new Response(JSON.stringify({ ok: true, event, demand_id: demand.id, action: "canceled" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // task field updates
    const apiKey = await getSecret(supabase, "clickup_api_key");
    const task = await fetchTaskFromClickUp(apiKey, taskId);

    const patch: any = { last_synced_from_clickup_at: new Date().toISOString() };
    const cuStatusName = task?.status?.status || "";
    const mapped = mapStatusReverse(cuStatusName);
    if (mapped && mapped !== demand.status) patch.status = mapped;
    // Remove o prefixo "[Projeto] " — COMPAT: taskName() no clickup-sync não põe mais
    // esse prefixo desde a v10 (hierarquia pasta-do-aluno→lista-do-projeto tornou o
    // prefixo redundante), mas tasks criadas ANTES da v10 ainda podem carregá-lo. Sem
    // custo manter (regex é no-op quando não há colchetes no início do nome).
    const cuName = typeof task?.name === "string" ? task.name.replace(/^\s*\[[^\]]*\]\s*/, "").trim() : "";
    if (cuName && cuName !== demand.title) patch.title = cuName;
    if (typeof task?.description === "string" && (task.description || "") !== (demand.description || "")) patch.description = task.description || "";
    if (task?.start_date) {
      const ds = new Date(Number(task.start_date)).toISOString().slice(0, 10);
      if (ds !== (demand.starts_at || "")) patch.starts_at = ds;
    }
    if (task?.due_date) {
      const dd = new Date(Number(task.due_date)).toISOString().slice(0, 10);
      if (dd !== (demand.ends_at || "")) patch.ends_at = dd;
    }
    if (mapped === "done" && !demand.finalized_at) patch.finalized_at = new Date().toISOString();

    const keys = Object.keys(patch).filter(k => k !== "last_synced_from_clickup_at");
    if (keys.length === 0) {
      return new Response(JSON.stringify({ ok: true, event, demand_id: demand.id, action: "no_change" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const { error: upErr } = await supabase.schema("portal")
      .from("demands").update(patch).eq("id", demand.id);
    if (upErr) throw new Error("update err: " + upErr.message);

    return new Response(JSON.stringify({
      ok: true, event, demand_id: demand.id, changed: keys,
      status: patch.status || demand.status,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
