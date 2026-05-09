import { test, expect } from '@playwright/test';

test.describe('smoke (post-supabase rewrite)', () => {
  test('login page renders', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
  });

  test('clickup proxy without JWT returns 401', async ({ request }) => {
    const r = await request.post('/api/clickup.php', { data: { method: 'GET', path: 'task/x' }});
    expect(r.status()).toBe(401);
  });

  test('clickup webhook without signature returns 401 or 503', async ({ request }) => {
    // 401 = signature invalida; 503 = secret não cadastrada (CI sem env). Ambos = fail-closed OK.
    const r = await request.post('/api/clickup-webhook.php', { data: { event: 'test' } });
    expect([401, 503]).toContain(r.status());
  });
});
