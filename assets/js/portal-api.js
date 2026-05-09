/**
 * portal-api.js — wrapper único pras chamadas ao backend PHP.
 *
 * Expõe window.GP_API com:
 *   - clickup(method, path, body, options) → Promise<Response>
 *   - apiRoot — URL absoluta do app (ex: https://host/servico/)
 *
 * Centraliza:
 *   1) Resolução do path correto (independente de /servico/ ou raiz)
 *   2) Injeção do JWT do Supabase no header Authorization
 *   3) Multipart vs JSON automaticamente
 */
(function () {
  'use strict';

  function appBase() {
    if (window.PortalAuth && window.PortalAuth.appBase) return window.PortalAuth.appBase;
    const script = document.currentScript || document.querySelector('script[src*="portal-api"]');
    const url = script ? new URL(script.src) : window.location;
    return new URL('./', url.href.replace(/assets\/js\/.*$/, '')).href;
  }

  const APP_BASE = appBase();
  const CLICKUP_URL = new URL('api/clickup.php', APP_BASE).href;

  async function getAccessToken() {
    try {
      const supabase = window.getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || '';
    } catch (_) { return ''; }
  }

  async function clickup(method, path, body, options) {
    const opts = options || {};
    const token = await getAccessToken();
    const clientSlug = (typeof window.CLIENTE_SLUG === 'string') ? window.CLIENTE_SLUG : '';
    const init = { method: 'POST', credentials: 'omit' };
    init.headers = {};
    if (token) init.headers['Authorization'] = 'Bearer ' + token;

    if (opts.files && opts.files.length) {
      const form = new FormData();
      form.append('clientSlug', clientSlug);
      form.append('method', method);
      form.append('path', path);
      if (body && typeof body === 'object') {
        for (const [k, v] of Object.entries(body)) {
          form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
      }
      for (const file of opts.files) {
        form.append('attachment', file, file.name);
      }
      init.body = form;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify({ clientSlug, method, path, body: body ?? null });
    }

    return fetch(CLICKUP_URL, init);
  }

  window.GP_API = { clickup, apiRoot: APP_BASE, clickupUrl: CLICKUP_URL };
})();
