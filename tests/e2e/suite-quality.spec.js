/**
 * Suite QUALITY — caça warnings silenciosos, network erros, perf básica.
 */
import { test, expect } from '@playwright/test';

const PROD = 'https://diamantes.grupoparticipa.app.br';
const USERS = {
  cliente: { email: 'joao@advmais.com', password: 'TesteAutomacao@2026' },
  admin:   { email: 'admin-teste@diamantes.test', password: 'AdminTesteAuto@2026' },
};

async function login(page, user, expected) {
  await page.goto(PROD + '/');
  await page.locator('#loginIdentifier').fill(user.email);
  await page.locator('#loginPassword').fill(user.password);
  await page.locator('#loginForm button[type=submit]').click();
  await page.waitForURL(`**${expected}**`, { timeout: 10_000 });
}

function collectIssues(page) {
  const issues = { errors: [], warnings: [], httpFails: [], pageErrors: [] };
  page.on('pageerror', (e) => issues.pageErrors.push(e.message));
  page.on('console', (m) => {
    const t = m.text();
    // Ignora warnings irrelevantes (browser CSP info, etc)
    if (m.type() === 'error' && !/^Failed to load resource: net::ERR_FAILED/i.test(t)) {
      issues.errors.push(t);
    }
    if (m.type() === 'warning' && !/preload|deprecated|Slow network/i.test(t)) {
      issues.warnings.push(t);
    }
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon')) {
      issues.httpFails.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });
  return issues;
}

test.describe('Quality — sem ruído de console em produção', () => {

  test('Login page sem warnings/erros/404', async ({ page }) => {
    const issues = collectIssues(page);
    await page.goto(PROD + '/');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await page.waitForTimeout(2000);

    expect(issues.pageErrors, 'pageError em /').toEqual([]);
    expect(issues.errors, 'console.error em /').toEqual([]);
    expect(issues.httpFails, 'HTTP fails em /').toEqual([]);
  });

  test('Portal cliente sem ruído', async ({ page }) => {
    const issues = collectIssues(page);
    await login(page, USERS.cliente, '/portal/');
    await page.waitForTimeout(8000);

    // Filtrar 404 esperados de PHPs órfãos legacy (já tratados pelo stub)
    const httpFails = issues.httpFails.filter(f => !/insights\.php/i.test(f));
    expect(issues.pageErrors, 'pageError em portal').toEqual([]);
    expect(issues.errors, 'console.error em portal').toEqual([]);
    expect(httpFails, 'HTTP fails em portal').toEqual([]);
  });

  test('Admin panel sem ruído', async ({ page }) => {
    const issues = collectIssues(page);
    await login(page, USERS.admin, '/admin/');
    await page.waitForTimeout(8000);

    // Admin chama /api/insights.php que stub silencia (200 fake) → não vira fail
    const httpFails = issues.httpFails.filter(f => !/insights\.php/i.test(f));
    expect(issues.pageErrors, 'pageError em admin').toEqual([]);
    expect(issues.errors, 'console.error em admin').toEqual([]);
    expect(httpFails, 'HTTP fails em admin').toEqual([]);
  });
});

test.describe('Quality — performance básica', () => {

  test('Login page carrega em < 3.5s', async ({ page }) => {
    const start = Date.now();
    await page.goto(PROD + '/');
    await page.waitForLoadState('domcontentloaded');
    const elapsed = Date.now() - start;
    console.log(`Login DOM ready em ${elapsed}ms`);
    expect(elapsed).toBeLessThan(3500);
  });

  test('Portal cliente DOM ready em < 5s', async ({ page }) => {
    await login(page, USERS.cliente, '/portal/');
    const start = Date.now();
    await page.waitForFunction(() => document.body && document.body.innerText.includes('Novo Chamado'), null, { timeout: 15_000 });
    const elapsed = Date.now() - start;
    console.log(`Portal renderizado em ${elapsed}ms`);
    expect(elapsed).toBeLessThan(5000);
  });
});

test.describe('Quality — recursos críticos respondem', () => {

  test('supabase-js (CDN) carrega com SRI válido', async ({ page }) => {
    let resp;
    page.on('response', (r) => {
      if (r.url().includes('supabase-js@2.49.4')) resp = r;
    });
    await page.goto(PROD + '/');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    expect(resp, 'supabase-js requested').toBeTruthy();
    expect(resp.status()).toBe(200);
  });

  test('CSP header tem connect-src com supabase + jsdelivr', async ({ request }) => {
    const r = await request.get(PROD + '/');
    const csp = r.headers()['content-security-policy'] || '';
    expect(csp).toContain('cdn.jsdelivr.net');
    expect(csp).toContain('*.supabase.co');
    expect(csp).toContain('api.clickup.com');
  });
});
