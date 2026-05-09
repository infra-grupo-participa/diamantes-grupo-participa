/**
 * E2E em produção — fluxo do cliente teste-automacao (joao@advmais.com).
 *
 * Roda contra https://diamantes.grupoparticipa.app.br/servico independente
 * do webServer local. Valida login + portal renderiza + zero erros.
 */
import { test, expect } from '@playwright/test';

const PROD = 'https://diamantes.grupoparticipa.app.br/servico';
const TEST_EMAIL = 'joao@advmais.com';
const TEST_PASSWORD = 'TesteAutomacao@2026';

test.describe('cliente teste-automacao em produção', () => {
  test('login + portal renderiza sem erros HTTP', async ({ page }) => {
    const errors = [];
    const httpFails = [];
    page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('ERR: ' + m.text()); });
    page.on('response', (r) => {
      if (r.status() >= 400) httpFails.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });

    await page.goto(PROD + '/');
    await page.locator('#loginIdentifier').fill(TEST_EMAIL);
    await page.locator('#loginPassword').fill(TEST_PASSWORD);
    await page.locator('#loginForm button[type=submit]').click();

    await page.waitForURL('**/portal/**', { timeout: 10_000 });
    expect(page.url()).toContain('?slug=teste-automacao');

    await page.waitForTimeout(8_000);
    expect(await page.title()).toContain('Teste Automação');

    const body = await page.locator('body').innerText();
    expect(body).toContain('Novo Chamado');
    expect(body).toContain('Meus Chamados');

    expect(errors, 'console errors em prod').toEqual([]);
    expect(httpFails, 'http failures em prod').toEqual([]);
  });

  test('portal exibe nome do cliente correto', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.locator('#loginIdentifier').fill(TEST_EMAIL);
    await page.locator('#loginPassword').fill(TEST_PASSWORD);
    await page.locator('#loginForm button[type=submit]').click();
    await page.waitForURL('**/portal/**', { timeout: 10_000 });
    await page.waitForTimeout(6_000);

    const body = await page.locator('body').innerText();
    expect(body).toContain('Teste Automação');
    expect(body).toContain('PERFIL DO CLIENTE');
  });

  test('forgot password link continua funcional', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.locator('#forgotLink').click();
    await expect(page.locator('#forgotView')).toHaveClass(/active/);
    await expect(page.locator('#forgotEmail')).toBeVisible();
  });
});
