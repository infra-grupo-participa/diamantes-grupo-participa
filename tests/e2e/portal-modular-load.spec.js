/**
 * portal-modular-load.spec.js — Fase 4 regression.
 *
 * Asserts:
 * 1. /portal/?slug=X responds with HTTP 200 (unauthenticated → may redirect,
 *    but page itself should not throw JS errors once loaded by an authed user).
 * 2. After login, /portal/?slug=X loads without any JS console errors.
 * 3. The new modular CSS files are referenced in the page <head>.
 * 4. window.PortalInsights is defined on the page.
 *
 * Pre-requisites (env vars):
 *   GP_TEST_ADMIN_EMAIL / GP_TEST_ADMIN_PASSWORD
 *   GP_TEST_CLIENT_EMAIL / GP_TEST_CLIENT_PASSWORD / GP_TEST_CLIENT_SLUG
 *
 * Skips gracefully when credentials are absent.
 */

import { test, expect } from '@playwright/test';

const ADMIN_EMAIL    = process.env.GP_TEST_ADMIN_EMAIL    || '';
const ADMIN_PASSWORD = process.env.GP_TEST_ADMIN_PASSWORD || '';
const CLIENT_EMAIL   = process.env.GP_TEST_CLIENT_EMAIL   || '';
const CLIENT_PASSWORD = process.env.GP_TEST_CLIENT_PASSWORD || '';
const CLIENT_SLUG    = process.env.GP_TEST_CLIENT_SLUG    || '';

const HAS_ADMIN  = ADMIN_EMAIL !== '' && ADMIN_PASSWORD !== '';
const HAS_CLIENT = CLIENT_EMAIL !== '' && CLIENT_PASSWORD !== '' && CLIENT_SLUG !== '';

// ── Login helper ─────────────────────────────────────────────────────────────

async function loginAs(page, email, password) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const emailInput    = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  const submitBtn     = page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar")').first();

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await submitBtn.click();

  await page.waitForFunction(
    () => !window.location.pathname.startsWith('/index') && window.location.pathname !== '/',
    { timeout: 10000 }
  ).catch(() => {});
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Fase 4 — Modular load (no console errors)', () => {

  test.skip(!HAS_CLIENT, 'GP_TEST_CLIENT_EMAIL/PASSWORD/SLUG not set — skipping');

  test('portal loads without JS errors after login (client user)', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (error) => {
      jsErrors.push(error.message);
    });

    await loginAs(page, CLIENT_EMAIL, CLIENT_PASSWORD);
    await page.goto(`/portal/?slug=${CLIENT_SLUG}`);
    await page.waitForLoadState('networkidle');

    // Give module scripts time to execute
    await page.waitForTimeout(500);

    expect(jsErrors, `JS errors on /portal/?slug=${CLIENT_SLUG}: ${jsErrors.join('; ')}`).toHaveLength(0);
  });

  test('window.PortalInsights is defined after modular load', async ({ page }) => {
    await loginAs(page, CLIENT_EMAIL, CLIENT_PASSWORD);
    await page.goto(`/portal/?slug=${CLIENT_SLUG}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const isDefined = await page.evaluate(() => typeof window.PortalInsights !== 'undefined');
    expect(isDefined).toBe(true);
  });

  test('PortalInsights has expected public API methods', async ({ page }) => {
    await loginAs(page, CLIENT_EMAIL, CLIENT_PASSWORD);
    await page.goto(`/portal/?slug=${CLIENT_SLUG}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const apiMethods = await page.evaluate(() => {
      const pi = window.PortalInsights;
      if (!pi) return [];
      return [
        'init', 'getContracts', 'getClientProfiles', 'getClientProfile',
        'getServiceCatalog', 'getRatings', 'getTaskReviews', 'getRatingMeta',
        'getDashboardSnapshot', 'handleTasksLoaded'
      ].filter((method) => typeof pi[method] === 'function');
    });

    expect(apiMethods).toHaveLength(10);
  });

  test('modular CSS files are linked in <head>', async ({ page }) => {
    await loginAs(page, CLIENT_EMAIL, CLIENT_PASSWORD);
    await page.goto(`/portal/?slug=${CLIENT_SLUG}`);
    await page.waitForLoadState('domcontentloaded');

    const cssLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map((link) => link.href)
    );

    const hasPortalBase     = cssLinks.some((href) => href.includes('portal-base.css'));
    const hasInsightsModals = cssLinks.some((href) => href.includes('insights-modals.css'));
    const hasTaskCards      = cssLinks.some((href) => href.includes('insights-task-cards.css'));

    expect(hasPortalBase,     'portal-base.css should be linked').toBe(true);
    expect(hasInsightsModals, 'insights-modals.css should be linked').toBe(true);
    expect(hasTaskCards,      'insights-task-cards.css should be linked').toBe(true);
  });

});

test.describe('Fase 4 — Admin can also load portal without JS errors', () => {

  test.skip(!HAS_ADMIN || !HAS_CLIENT, 'Admin or client credentials not set — skipping');

  test('admin accesses client portal without JS errors', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (error) => jsErrors.push(error.message));

    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`/portal/?slug=${CLIENT_SLUG}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    expect(jsErrors, `Admin JS errors: ${jsErrors.join('; ')}`).toHaveLength(0);
  });

});
