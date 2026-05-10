/**
 * legacy-insights-stub.js — Compat shim pro código legado de admin.
 *
 * 1) Intercepta fetch pra /api/insights.php (e /auth, /users, /export) e
 *    devolve fallback vazio coerente — endpoints removidos no rewrite Supabase.
 * 2) Quando window.PortalInsights aparecer (carregado via portal-insights.js
 *    legado), patcha getDashboardSnapshot pra retornar estrutura completa,
 *    evitando "Cannot read properties of undefined (reading 'changesRequested')"
 *    nos renderXxxDashboard.
 *
 * Quando portarmos insights pra Supabase REST, esse shim é deletado.
 */
(function () {
  'use strict';
  if (window.__gpInsightsStubInstalled) return;
  window.__gpInsightsStubInstalled = true;

  // ── Fallback snapshot (estrutura esperada pelos renders do admin) ──
  const FALLBACK_SNAPSHOT = {
    diamonds: {
      totalClients: 0,
      totalActiveServices: 0,
      totalCanceledServices: 0,
      monthlyProfilePending: 0,
      lateBillingClients: 0,
      mostContractedServices: [],
      clients: [],
    },
    employees: [],
    clientProfiles: {},
    reviewFlow: {
      approved: 0,
      changesRequested: 0,
      pending: 0,
      rejected: 0,
    },
    topPerformers: [],
    bottomPerformers: [],
    summary: {
      totalReviews: 0,
      averageRating: 0,
      changesRequested: 0,
      approved: 0,
    },
    services: [],
    insights: {},
  };

  function deepMerge(base, override) {
    if (!override || typeof override !== 'object') return base;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k of Object.keys(override)) {
      const v = override[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
        out[k] = deepMerge(base[k], v);
      } else if (v !== undefined && v !== null) {
        out[k] = v;
      }
    }
    return out;
  }

  // ── Fetch interceptor pra /api/*.php legados ──
  const FETCH_FALLBACK_BODY = JSON.stringify(Object.assign({ ok: true }, FALLBACK_SNAPSHOT));
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (typeof url === 'string' && /\/api\/(insights|auth|users|export)\.php/.test(url)) {
      return Promise.resolve(new Response(FETCH_FALLBACK_BODY, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    return origFetch.apply(this, arguments);
  };

  // ── Patch PortalInsights.getDashboardSnapshot quando carregar ──
  function patchPortalInsights() {
    const PI = window.PortalInsights;
    if (!PI || PI.__gpStubPatched) return false;
    const orig = typeof PI.getDashboardSnapshot === 'function' ? PI.getDashboardSnapshot.bind(PI) : null;
    PI.getDashboardSnapshot = function () {
      let real = null;
      if (orig) {
        try { real = orig.apply(this, arguments); } catch (_) { real = null; }
      }
      return deepMerge(FALLBACK_SNAPSHOT, real || {});
    };
    PI.__gpStubPatched = true;
    return true;
  }

  // Tenta agora e a cada 100ms até sucesso (max 5s)
  if (!patchPortalInsights()) {
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (patchPortalInsights() || tries > 50) clearInterval(iv);
    }, 100);
  }
})();
