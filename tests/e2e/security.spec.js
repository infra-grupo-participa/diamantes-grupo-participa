/**
 * security.spec.js
 *
 * E2E security assertions:
 *
 * 1. Login response body does not contain a bcrypt hash ($2y$).
 * 2. Bootstrap-state response does not contain a bcrypt hash.
 * 3. Register response does not contain a bcrypt hash.
 *
 * These cover the CWE-312 fix (gp_public_user strips password before serialisation).
 *
 * Uses Playwright's APIRequestContext so tests run without a browser window,
 * matching the CSRF / rate-limit spec pattern already in this suite.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8765';
const BCRYPT_PATTERN = /\$2[ayb]\$/;

/** Obtain a fresh CSRF token + session cookie from a shared context. */
async function getCsrfToken(ctx) {
  const resp = await ctx.get('/api/csrf.php');
  const body = await resp.json().catch(() => ({}));
  return body.csrfToken ?? '';
}

test.describe('API responses must not leak bcrypt hashes (CWE-312)', () => {
  test('login response does not contain $2y$ hash', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });

    const csrfToken = await getCsrfToken(ctx);
    if (!csrfToken) {
      await ctx.dispose();
      test.skip('Could not obtain CSRF token');
      return;
    }

    // Attempt login with a non-existent account — response body is what matters.
    const resp = await ctx.post('/api/auth.php?action=login', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      data: JSON.stringify({
        identifier: `security-test-${Date.now()}@test.invalid`,
        password: 'wrong-password-123',
      }),
    });

    const text = await resp.text();

    expect(text).not.toMatch(
      BCRYPT_PATTERN,
      'Login response must not contain a bcrypt hash ($2y$/$2a$/$2b$)'
    );

    // If the server happened to return ok:true with a user object, verify no password key.
    const body = JSON.parse(text);
    if (body.user) {
      expect(body.user).not.toHaveProperty('password');
    }

    await ctx.dispose();
  });

  test('bootstrap-state response does not contain $2y$ hash', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });

    const resp = await ctx.get('/api/auth.php?action=bootstrap');
    const text = await resp.text();

    expect(text).not.toMatch(
      BCRYPT_PATTERN,
      'Bootstrap-state response must not contain a bcrypt hash'
    );

    const body = JSON.parse(text);
    if (body.sessionUser) {
      expect(body.sessionUser).not.toHaveProperty('password');
    }

    await ctx.dispose();
  });

  test('bootstrap includeUsers response does not contain $2y$ hash', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });

    // No auth — will return 401/403 or an empty users list.
    // Regardless, the body must not contain any bcrypt hash.
    const resp = await ctx.get('/api/auth.php?action=bootstrap&includeUsers=1');
    const text = await resp.text();

    expect(text).not.toMatch(
      BCRYPT_PATTERN,
      'Bootstrap includeUsers response must not contain a bcrypt hash'
    );

    await ctx.dispose();
  });

  test('register response does not contain $2y$ hash', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });

    const csrfToken = await getCsrfToken(ctx);
    if (!csrfToken) {
      await ctx.dispose();
      test.skip('Could not obtain CSRF token');
      return;
    }

    // Use a unique email so it either creates a real user (new path) or hits the
    // duplicate path on re-run — both must not expose hashes.
    const email = `reg-security-test-${Date.now()}@test.invalid`;

    const resp = await ctx.post('/api/auth.php?action=register', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      data: JSON.stringify({
        name: 'Security Test User',
        email,
        password: 'SecurePass123!',
        documentType: 'cpf',
        documentValue: '12345678901',
        setSession: false,
      }),
    });

    const text = await resp.text();

    expect(text).not.toMatch(
      BCRYPT_PATTERN,
      'Register response must not contain a bcrypt hash'
    );

    const body = JSON.parse(text);
    if (body.user) {
      expect(body.user).not.toHaveProperty('password');
    }

    await ctx.dispose();
  });
});
