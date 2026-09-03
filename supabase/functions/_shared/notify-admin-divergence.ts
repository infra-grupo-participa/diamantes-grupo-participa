// _shared/notify-admin-divergence.ts — dispara o alerta de divergência de
// responsáveis (ClickUp x portal) ao admin, reusando a trilha existente
// (email_log + edge send-email). Extraído de clickup-sync e clickup-webhook
// (migration 086, revisão 2026-09-03 — estava duplicado literalmente nos dois
// arquivos). Best-effort: falha só loga, nunca derruba a operação principal
// (mesma lição das migrations 032/054/055).
//
// context:'sync'    → clickup-sync (estados partial/partial_expected/none, saída
//                      portal→ClickUp) — send-email usa o rótulo "foi/ficou de fora".
// context:'webhook' → clickup-webhook (estado external, mudança direta no ClickUp)
//                      — send-email usa o rótulo "portal esperava/ClickUp tem".
//
// Respeita clickup_config.assignee_alert_email='off' (migration 086/087): quando
// desligado, a reconciliação continua gravando o estado normalmente — só o e-mail
// é suprimido. Passar cfg já carregado evita reconsultar clickup_config aqui.
export async function notifyAdminDivergence(
  supabase: any,
  supabaseUrl: string,
  getSecret: (supabase: any, name: string) => Promise<string>,
  cfg: Record<string, string>,
  demand_id: string,
  context: "sync" | "webhook",
  before: string[],
  after: string[],
): Promise<void> {
  if ((cfg?.assignee_alert_email || "on") === "off") return;
  try {
    const key = await getSecret(supabase, "clickup_sync_internal_key");
    if (!key) return;
    await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": key },
      body: JSON.stringify({ type: "divergencia_assignee", demand_id, context, before, after }),
    });
  } catch (e) {
    console.error("notifyAdminDivergence err", demand_id, (e as any)?.message || e);
  }
}
