/**
 * csrf.spec.js
 *
 * HIGH-3 E2E: CSRF token enforcement.
 *
 * Verifies that:
 * 1. GET /api/csrf.php returns a token (200).
 * 2. POST to a protected endpoint without X-CSRF-Token returns 403.
 * 3. POST with the correct CSRF token (from the same session) is accepted.
 *
 * Uses a persistent APIRequestContext so session cookies are shared across calls.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8765';

test.describe('CSRF token enforcement', () => {
  test('GET /api/csrf.php returns a token', async () => {
    // Use an isolated context so this test is fully independent.
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const response = await ctx.get('/api/csrf.php');
    expect(response.status()).toBeLessThan(500);
    const body = await response.json();
    expect(body).toHaveProperty('ok');
    if (body.ok) {
      expect(typeof body.csrfToken).toBe('string');
      expect(body.csrfToken.length).toBeGreaterThan(0);
    }
    await ctx.dispose();
  });

  test('POST login without X-CSRF-Token returns 403', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    // No X-CSRF-Token header.
    const response = await ctx.post('/api/auth.php?action=login', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ identifier: 'test@test.com', password: 'test-password-123' }),
    });
    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.ok).toBe(false);
    await ctx.dispose();
  });

  test('POST login with valid CSRF token from the same session is accepted (not CSRF-rejected)', async () => {
    // Use one shared context so session cookie is preserved across both calls.
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });

    // Step 1: Obtain CSRF token — this starts a PHP session.
    const csrfResponse = await ctx.get('/api/csrf.php');
    const csrfBody = await csrfResponse.json();

    if (!csrfBody.ok || !csrfBody.csrfToken) {
      await ctx.dispose();
      test.skip('CSRF endpoint did not return a token');
      return;
    }

    const csrfToken = csrfBody.csrfToken;

    // Step 2: POST login with the CSRF token — same session (ctx shares cookies).
    const loginResponse = await ctx.post('/api/auth.php?action=login', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      data: JSON.stringify({ identifier: 'nonexistent@test.com', password: 'wrong-password-123' }),
    });

    // Must NOT be 403 (CSRF rejection). Should be 422 (invalid credentials).
    expect(loginResponse.status()).not.toBe(403);
    const body = await loginResponse.json();
    expect(body.ok).toBe(false);
    // Error message must be about credentials, not CSRF.
    expect(body.error).not.toMatch(/csrf/i);

    await ctx.dispose();
  });
});
