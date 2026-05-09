/**
 * insights-api.js — wrapper resilient pra api/insights.php.
 *
 * No rewrite Supabase, insights.php foi removido. Pra não quebrar UI,
 * apiRequest é silent: se o backend não existe (404) ou rejeita auth
 * (401), retorna fallback estruturado. Funcionalidades de persistência
 * server-side (contracts, profiles, ratings, reviews) ficam efetivamente
 * desativadas até serem portadas pra Supabase REST.
 */

const FALLBACK_PAYLOAD = {
  ok: true,
  contracts:    { byService: {} },
  profiles:     {},
  ratings:      {},
  reviews:      {},
  task_reviews: {},
  status:       {},
  data:         {},
};

let _warned = false;
function warnOnce(msg) {
  if (_warned) return;
  _warned = true;
  console.warn("[insights-api] " + msg);
}

export function getInsightsApiUrl() { return ""; }

export async function apiRequest(action, _options) {
  warnOnce("backend insights.php desativado — operando em modo local-only");
  // Retorna fallback consistente — quem espera payload.ok não quebra
  return { ...FALLBACK_PAYLOAD, action };
}
