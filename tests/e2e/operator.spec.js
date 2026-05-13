/**
 * Suite E2E — bloqueio de acesso ao portal do operador.
 *
 * Operadores não têm mais acesso autenticado ao sistema — atuam via ClickUp.
 * Este arquivo substitui os testes de fluxo do operador por testes de bloqueio.
 */
import { test, expect } from '@playwright/test';

const PROD = 'https://diamantes.grupoparticipa.app.br';

test.describe('Bloqueio de acesso — área operador', () => {

  test('GET /operator/dashboard.html redireciona para login', async ({ page }) => {
    await page.goto(PROD + '/operator/dashboard.html');
    // Sem sessão → deve ir para login (/)
    await page.waitForURL((url) => !url.toString().includes('/operator/'), { timeout: 10_000 });
    expect(page.url()).not.toContain('/operator/');
  });

  test('GET /operator/demandas.html redireciona para login', async ({ page }) => {
    await page.goto(PROD + '/operator/demandas.html');
    await page.waitForURL((url) => !url.toString().includes('/operator/'), { timeout: 10_000 });
    expect(page.url()).not.toContain('/operator/');
  });

  test('Login com credencial de operador é bloqueado e redireciona para login', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.waitForSelector('#loginIdentifier', { timeout: 8_000 });

    // Tenta logar com um email de operador desabilitado (status=disabled na migration 016)
    // Se a conta não existir no ambiente o teste passa pela negação de URL
    await page.locator('#loginIdentifier').fill('operador@diamantes.test');
    await page.locator('#loginPassword').fill('Operador@2026');
    await page.locator('#loginForm button[type=submit]').click();

    // Não deve redirecionar para /operator/
    await page.waitForTimeout(4_000);
    expect(page.url()).not.toContain('/operator/');
  });

});
