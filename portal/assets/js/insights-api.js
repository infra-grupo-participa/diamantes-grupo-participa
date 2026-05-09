/**
 * insights-api.js — API communication wrapper (fetch to api/insights.php).
 *
 * Resolves the base URL relative to portal-insights-bootstrap.js location,
 * which is in portal/assets/js/. From there, ../../ goes back to the project
 * root where api/ lives. We also support window.PORTAL_API_ROOT for DI.
 */

// Compute insightsApiUrl once at module evaluation time.
// portal/assets/js/ → ../../ → project root → api/insights.php
const _scriptUrl = import.meta.url;
const _appRootUrl = new URL("../../..", _scriptUrl);
const insightsApiUrl = new URL("api/insights.php", _appRootUrl).href;

export function getInsightsApiUrl() {
  return insightsApiUrl;
}

export async function apiRequest(action, options) {
  const settings = options || {};
  const headers  = new Headers(settings.headers || {});
  const init = {
    method:      settings.method || "GET",
    credentials: "same-origin",
    headers,
  };

  if (Object.prototype.hasOwnProperty.call(settings, "body")) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(settings.body);
  }

  const response = await window.fetch(`${insightsApiUrl}?action=${action}`, init);
  const payload  = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok === false) {
    throw new Error(payload && payload.error ? payload.error : `Erro ${response.status}`);
  }
  return payload;
}
