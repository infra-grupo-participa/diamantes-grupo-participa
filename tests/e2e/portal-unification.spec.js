/**
 * portal-unification.spec.js — Fase 3 snapshot tests.
 *
 * For each of the 27 slugs, verifies:
 * 1. GET /portal/?slug={slug} returns 200 with expected client data.
 * 2. The rendered HTML does not contain unreplaced placeholders.
 * 3. Authorization: a user with slug X cannot access slug Y (403).
 * 4. Admin can access any slug.
 *
 * Byte-equivalence between /portal/?slug=X and /{slug}/index.html is
 * verified separately in the diff helpers below. The test saves a diff
 * file in test-results/ when it finds a divergence.
 *
 * Pre-requisites:
 *   GP_TEST_ADMIN_EMAIL / GP_TEST_ADMIN_PASSWORD — admin credentials
 *   GP_TEST_CLIENT_EMAIL / GP_TEST_CLIENT_PASSWORD / GP_TEST_CLIENT_SLUG — one client user
 *
 * Skips gracefully when credentials are absent (CI without creds).
 */
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ADMIN_EMAIL    = process.env.GP_TEST_ADMIN_EMAIL    || '';
const ADMIN_PASSWORD = process.env.GP_TEST_ADMIN_PASSWORD || '';
const CLIENT_EMAIL   = process.env.GP_TEST_CLIENT_EMAIL   || '';
const CLIENT_PASSWORD = process.env.GP_TEST_CLIENT_PASSWORD || '';
const CLIENT_SLUG    = process.env.GP_TEST_CLIENT_SLUG    || '';

const HAS_ADMIN  = ADMIN_EMAIL !== '' && ADMIN_PASSWORD !== '';
const HAS_CLIENT = CLIENT_EMAIL !== '' && CLIENT_PASSWORD !== '' && CLIENT_SLUG !== '';

const ALL_SLUGS = [
  'alessandro-lima', 'anthony-sodre', 'bartira-paes', 'bernadete',
  'bruno-couto', 'claudia-kellner', 'deyse-engel', 'fabiana-parro',
  'felipe-schroeder', 'fernanda-lessa', 'isabela-teixeira',
  'joao-carlos-lima', 'joao-eduardo-zanela', 'katia-paixao',
  'luciano-simionato', 'luis-rocha', 'matheus-borges', 'nairio',
  'osvaldo-catena', 'paulo-guaraciaba', 'pedro-nery', 'priscila-ziliani',
  'rafael-molino', 'roberto-gaspar', 'suely-resende', 'vitor-negrao',
  'willian-loro',
];

// ── Helper: login via API ────────────────────────────────────────────────────

async function loginAs(page, email, password) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const emailInput    = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  const submitBtn     = page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar")').first();

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await submitBtn.click();

  // Wait for redirect away from login.
  await page.waitForFunction(
    () => !window.location.pathname.startsWith('/index') && window.location.pathname !== '/',
    { timeout: 10_000 }
  ).catch(() => null);
}

// ── Helper: normalize HTML for comparison ────────────────────────────────────

function normalizeForDiff(html) {
  // Remove CSRF tokens (64-char hex strings in meta tags or data attributes).
  return html
    .replace(/content="[a-f0-9]{64}"/gi, 'content="CSRF_TOKEN"')
    .replace(/data-csrf="[a-f0-9]{64}"/gi, 'data-csrf="CSRF_TOKEN"')
    .replace(/csrf[_-]token="[a-f0-9]{64}"/gi, 'csrf-token="CSRF_TOKEN"')
    // Normalize line endings.
    .replace(/\r\n/g, '\n');
}

function saveDiff(slug, portalHtml, legacyHtml) {
  try {
    mkdirSync('test-results', { recursive: true });
    const diffPath = join('test-results', `snapshot-diff-${slug}.html`);
    writeFileSync(diffPath, [
      '<h1>Diff: ' + slug + '</h1>',
      '<h2>/portal/?slug=' + slug + '</h2>',
      '<pre>' + portalHtml.replace(/</g, '&lt;') + '</pre>',
      '<h2>/' + slug + '/index.html</h2>',
      '<pre>' + legacyHtml.replace(/</g, '&lt;') + '</pre>',
    ].join('\n'));
    console.log(`[diff saved] test-results/snapshot-diff-${slug}.html`);
  } catch (_) { /* best effort */ }
}

// ── Tests: unauthorized access ───────────────────────────────────────────────

test.describe('Portal authorization', () => {
  test('GET /portal/ without session returns 401 or redirects to login', async ({ page }) => {
    const response = await page.goto('/portal/?slug=alessandro-lima');
    // Either 401 status, or redirected to login page.
    const status = response?.status() ?? 0;
    const url    = page.url();
    const isLoginPage = url.includes('index.html') || url.endsWith('/');
    expect(status === 401 || isLoginPage, `Expected 401 or redirect to login, got ${status} at ${url}`).toBe(true);
  });
});

// ── Tests: admin access ──────────────────────────────────────────────────────

test.describe('Admin portal access', () => {
  test.skip(!HAS_ADMIN, 'Skipped: GP_TEST_ADMIN_EMAIL / GP_TEST_ADMIN_PASSWORD not set');

  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  for (const slug of ALL_SLUGS) {
    test(`admin can load /portal/?slug=${slug}`, async ({ page }) => {
      const response = await page.goto(`/portal/?slug=${slug}`);
      expect(response?.status(), `Expected 200 for ${slug}`).toBe(200);

      // No unreplaced placeholders.
      const body = await page.content();
      expect(body).not.toContain('{{');
      expect(body).not.toContain('}}');

      // Title should not be the broken "Luís Rocha" for Alessandro Lima.
      if (slug === 'alessandro-lima') {
        const title = await page.title();
        expect(title).toContain('Alessandro Lima');
        expect(title).not.toContain('Luís Rocha');
      }
    });
  }
});

// ── Tests: snapshot equivalence (admin vs legacy) ────────────────────────────

test.describe('Snapshot equivalence: /portal/ vs legacy static HTML', () => {
  test.skip(!HAS_ADMIN, 'Skipped: admin credentials not set');

  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  for (const slug of ALL_SLUGS) {
    test(`/portal/?slug=${slug} matches /${slug}/index.html`, async ({ page }) => {
      // Fetch portal endpoint.
      const portalResponse = await page.goto(`/portal/?slug=${slug}`);
      expect(portalResponse?.status()).toBe(200);
      const portalHtml = normalizeForDiff(await page.content());

      // Fetch legacy static file.
      const legacyResponse = await page.goto(`/${slug}/index.html`);
      const legacyStatus = legacyResponse?.status() ?? 0;

      if (legacyStatus === 404 || legacyStatus === 302 || legacyStatus === 301) {
        // Legacy file already removed or redirected — skip byte comparison.
        test.info().annotations.push({
          type: 'note',
          description: `Legacy /${slug}/index.html returned ${legacyStatus} — skipping byte comparison`,
        });
        return;
      }

      const legacyHtml = normalizeForDiff(await page.content());

      if (portalHtml !== legacyHtml) {
        saveDiff(slug, portalHtml, legacyHtml);
      }

      expect(
        portalHtml,
        `HTML mismatch for ${slug} — diff saved to test-results/snapshot-diff-${slug}.html`
      ).toBe(legacyHtml);
    });
  }
});

// ── Tests: client IDOR prevention ────────────────────────────────────────────

test.describe('Client IDOR prevention', () => {
  test.skip(!HAS_CLIENT, 'Skipped: GP_TEST_CLIENT_EMAIL / GP_TEST_CLIENT_PASSWORD / GP_TEST_CLIENT_SLUG not set');

  test.beforeEach(async ({ page }) => {
    await loginAs(page, CLIENT_EMAIL, CLIENT_PASSWORD);
  });

  test('client user can access their own portal', async ({ page }) => {
    const response = await page.goto(`/portal/?slug=${CLIENT_SLUG}`);
    expect(response?.status()).toBe(200);
  });

  test('client user gets 403 when accessing a different slug', async ({ page }) => {
    // Pick any slug that is NOT the client's own.
    const otherSlug = ALL_SLUGS.find((s) => s !== CLIENT_SLUG) || 'alessandro-lima';
    const response = await page.goto(`/portal/?slug=${otherSlug}`);
    expect(response?.status()).toBe(403);
  });

  test('client user accessing their portal has no unreplaced placeholders', async ({ page }) => {
    await page.goto(`/portal/?slug=${CLIENT_SLUG}`);
    const body = await page.content();
    expect(body).not.toContain('{{');
    expect(body).not.toContain('}}');
  });
});
