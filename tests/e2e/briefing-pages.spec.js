/**
 * briefing-pages.spec.js — E2E sem-auth das telas do novo modelo de briefing.
 * Valida: páginas servem 200, NÃO lançam erro JS no load, guard redireciona p/ login,
 * e o CSS/JS compartilhado carrega.
 */
import { test, expect } from '@playwright/test';

const NEW_PAGES = [
  '/portal/briefing-basico.html',
  '/portal/novo-projeto.html',
  '/portal/projetos.html',
  '/portal/demandas.html',
  '/portal/dashboard.html',
  '/portal/briefing.html?projeto=00000000-0000-0000-0000-000000000000',
  '/admin/projetos.html',
];

test.describe('Briefing — telas novas (sem auth)', () => {
  for (const path of NEW_PAGES) {
    test(`carrega sem erro JS: ${path}`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') {
        const t = m.text();
        // ignora ruído esperado de rede/auth ao redirecionar deslogado
        if (!/Failed to load resource|net::|401|400|supabase|getSession|Auth/i.test(t)) errors.push('console: ' + t);
      }});
      const resp = await page.goto(path, { waitUntil: 'commit' }).catch(() => null);
      if (resp) expect(resp.status(), `status ${path}`).toBeLessThan(400);
      await page.waitForTimeout(1200); // deixa o guard/redirect rodar
      expect(errors, `erros JS em ${path}`).toEqual([]);
    });
  }

  test('guard: deslogado vai p/ login', async ({ page }) => {
    await page.goto('/portal/briefing-basico.html', { waitUntil: 'commit' }).catch(() => {});
    await page.waitForURL(url => !url.pathname.includes('briefing-basico'), { timeout: 8000 }).catch(() => {});
    expect(page.url()).not.toContain('briefing-basico.html');
  });

  test('briefing.css serve 200 e tem field-grid', async ({ request }) => {
    const r = await request.get('/portal/assets/briefing.css');
    expect(r.status()).toBe(200);
    const body = await r.text();
    expect(body).toContain('.field-grid');
    expect(body).toContain('.section-panel');
  });

  test('briefing-templates.js serve e expõe helpers', async ({ request }) => {
    const r = await request.get('/portal/assets/briefing-templates.js');
    expect(r.status()).toBe(200);
    const body = await r.text();
    expect(body).toContain('BRIEFING_ACTIVE_SERVICES');
    expect(body).toContain('validateProjectBriefing');
    expect(body).toContain('getBaseSections');
  });

  test('demandas.html sem legado de briefing-por-demanda', async ({ request }) => {
    const r = await request.get('/portal/demandas.html');
    const body = await r.text();
    expect(body).not.toContain('briefing.html?demanda');
    expect(body).not.toContain('hasPendingBriefing');
  });

  test('dashboard.html sem botão de mensagem na equipe', async ({ request }) => {
    const r = await request.get('/portal/dashboard.html');
    const body = await r.text();
    expect(body).not.toContain('Mandar mensagem');
    expect(body).toContain('gateBanner');
  });
});
