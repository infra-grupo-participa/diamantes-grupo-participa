/**
 * Smoke visual — roda em modo headed pra você ver os fluxos no navegador.
 * Tira screenshot de cada etapa em test-results/screenshots/.
 *
 * Rode com: npx playwright test tests/e2e/_smoke-visual.spec.js --headed --workers=1
 */
import { test, expect } from '@playwright/test';
import path from 'path';

const PROD = 'https://diamantes.grupoparticipa.app.br/servico';
const SHOTS = 'test-results/screenshots';

const slow = async (page, ms = 1500) => page.waitForTimeout(ms);

test.describe.configure({ mode: 'serial' });

test.describe('Smoke visual em produção', () => {

  test('1. Login page + Esqueci senha + Cadastrar (aviso)', async ({ page }) => {
    await page.goto(PROD + '/');
    await slow(page, 2000);
    await page.screenshot({ path: path.join(SHOTS, '01-login-page.png'), fullPage: true });

    // Esqueci minha senha
    await page.locator('#forgotLink').click();
    await slow(page);
    await page.screenshot({ path: path.join(SHOTS, '02-forgot-view.png'), fullPage: true });

    // Voltar
    await page.locator('#forgotBackLink').click();
    await slow(page);

    // Tab Cadastrar (deve mostrar aviso de convite)
    await page.locator('[data-tab="register"]').click();
    await slow(page);
    await page.screenshot({ path: path.join(SHOTS, '03-register-aviso-convite.png'), fullPage: true });
  });

  test('2. Login admin → /admin/ renderiza', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.locator('#loginIdentifier').fill('admin-teste@diamantes.test');
    await page.locator('#loginPassword').fill('AdminTesteAuto@2026');
    await slow(page, 1000);
    await page.screenshot({ path: path.join(SHOTS, '04-login-admin-preenchido.png'), fullPage: true });
    await page.locator('#loginForm button[type=submit]').click();

    await page.waitForURL('**/admin/**', { timeout: 10_000 });
    await slow(page, 4000);
    await page.screenshot({ path: path.join(SHOTS, '05-admin-panel.png'), fullPage: true });
  });

  test('3. Login cliente teste → portal renderiza', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.locator('#loginIdentifier').fill('joao@advmais.com');
    await page.locator('#loginPassword').fill('TesteAutomacao@2026');
    await slow(page, 1000);
    await page.screenshot({ path: path.join(SHOTS, '06-login-cliente-preenchido.png'), fullPage: true });
    await page.locator('#loginForm button[type=submit]').click();

    await page.waitForURL('**/portal/**', { timeout: 10_000 });
    await slow(page, 5000);
    await page.screenshot({ path: path.join(SHOTS, '07-portal-cliente-renderizado.png'), fullPage: true });

    // Scroll pra baixo pra ver perfil
    await page.evaluate(() => window.scrollBy(0, 600));
    await slow(page);
    await page.screenshot({ path: path.join(SHOTS, '08-portal-cliente-perfil.png'), fullPage: true });
  });

  test('4. Tentar IDOR (cliente acessa outro slug)', async ({ page }) => {
    // Login como cliente teste
    await page.goto(PROD + '/');
    await page.locator('#loginIdentifier').fill('joao@advmais.com');
    await page.locator('#loginPassword').fill('TesteAutomacao@2026');
    await page.locator('#loginForm button[type=submit]').click();
    await page.waitForURL('**/portal/**', { timeout: 10_000 });
    await slow(page, 3000);

    // Tenta navegar pra slug de OUTRO cliente
    await page.goto(PROD + '/portal/?slug=joao-eduardo-zanela');
    await slow(page, 4000);
    await page.screenshot({ path: path.join(SHOTS, '09-idor-bloqueado.png'), fullPage: true });
  });

  test('5. Credencial errada mostra erro', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.locator('#loginIdentifier').fill('joao@advmais.com');
    await page.locator('#loginPassword').fill('senha-errada-mesmo');
    await page.locator('#loginForm button[type=submit]').click();
    await slow(page, 3000);
    await page.screenshot({ path: path.join(SHOTS, '10-credencial-errada.png'), fullPage: true });
  });

  test('6. Hash recovery (#type=recovery) → resetView', async ({ page }) => {
    await page.goto(PROD + '/#access_token=fake&refresh_token=fake&type=recovery&expires_in=3600');
    await slow(page, 3000);
    await page.screenshot({ path: path.join(SHOTS, '11-reset-password-view.png'), fullPage: true });
  });

  test('7. Forgot password real (envio)', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.locator('#forgotLink').click();
    await slow(page);
    await page.locator('#forgotEmail').fill('joao@advmais.com');
    await slow(page);
    await page.locator('#forgotForm button[type=submit]').click();
    await slow(page, 4000);
    await page.screenshot({ path: path.join(SHOTS, '12-forgot-success.png'), fullPage: true });
  });
});
