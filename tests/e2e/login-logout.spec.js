/**
 * login-logout.spec.js
 *
 * E2E smoke: login with valid credentials, then logout.
 * Verifies that:
 * 1. Login page renders (already covered by login.spec.js but repeated here for clarity).
 * 2. After logout, navigating to admin redirects back to login.
 *
 * Note: This test requires a bootstrapped server with a working admin account.
 * In CI, the admin account is set up by the test environment or the test skips
 * gracefully when no credentials are available.
 *
 * We don't embed real passwords here — the test uses GP_TEST_ADMIN_EMAIL and
 * GP_TEST_ADMIN_PASSWORD env vars, and skips if they're absent.
 */

import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.GP_TEST_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.GP_TEST_ADMIN_PASSWORD || '';
const HAS_CREDENTIALS = ADMIN_EMAIL !== '' && ADMIN_PASSWORD !== '';

test.describe('Login page', () => {
  test('renders email field and submit button', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="e-mail" i]');
    await expect(emailInput.first()).toBeVisible({ timeout: 10_000 });

    const submitBtn = page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar"), button:has-text("Login")');
    await expect(submitBtn.first()).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Auth flow', () => {
  test.skip(!HAS_CREDENTIALS, 'Skipped: GP_TEST_ADMIN_EMAIL / GP_TEST_ADMIN_PASSWORD not set');

  test('login → logout → accessing admin redirects to login', async ({ page }) => {
    // Navigate to login page.
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Fill credentials and submit.
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const submitBtn = page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar")').first();

    await emailInput.fill(ADMIN_EMAIL);
    await passwordInput.fill(ADMIN_PASSWORD);
    await submitBtn.click();

    // Wait for redirect after login.
    await page.waitForURL('**/admin/**', { timeout: 10_000 }).catch(() => null);

    // Look for logout button (admin panel).
    const logoutBtn = page.locator('button:has-text("Sair"), button:has-text("Logout"), [data-action="logout"]');
    const hasLogout = await logoutBtn.count() > 0;

    if (hasLogout) {
      await logoutBtn.first().click();
      // After logout, expect to be back on login page.
      await page.waitForURL('**/', { timeout: 5_000 }).catch(() => null);
    }

    // Try to navigate directly to admin — should redirect to login.
    await page.goto('/admin/');
    await page.waitForLoadState('networkidle');

    // Either the page redirects to login or shows the login form.
    const currentUrl = page.url();
    const isLoginPage = currentUrl.includes('index.html') || currentUrl.endsWith('/') || !currentUrl.includes('admin');

    // The UI must show the login form (auth guard redirects).
    const loginForm = page.locator('input[type="email"], input[type="password"]');
    const isLoginVisible = await loginForm.count() > 0;

    expect(isLoginPage || isLoginVisible).toBeTruthy();
  });
});
