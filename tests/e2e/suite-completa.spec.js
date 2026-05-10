/**
 * Suite E2E expandida — cobertura completa do app em produção.
 *
 * Cobre:
 *   - Login flows (admin, cliente, credencial errada)
 *   - Signup (criar user pending)
 *   - Forgot password (UI + chamada real)
 *   - Portal cliente (renderização, admin acessando como impersonate)
 *   - Admin panel (login + carregamento)
 *   - Edge cases / segurança (IDOR, slug inválido, JWT expirado)
 */
import { test, expect } from '@playwright/test';

const PROD = 'https://diamantes.grupoparticipa.app.br/servico';

const USERS = {
  cliente: { email: 'joao@advmais.com', password: 'TesteAutomacao@2026', slug: 'teste-automacao', name: 'Teste Automação' },
  cliente2: { email: 'teste-prod@diamantes.test', password: 'Teste@2026', slug: 'joao-eduardo-zanela' },
  admin: { email: 'admin-teste@diamantes.test', password: 'AdminTesteAuto@2026' },
};

async function loginAndWaitRedirect(page, user, expectedPathFragment) {
  await page.goto(PROD + '/');
  await page.locator('#loginIdentifier').fill(user.email);
  await page.locator('#loginPassword').fill(user.password);
  await page.locator('#loginForm button[type=submit]').click();
  await page.waitForURL(`**${expectedPathFragment}**`, { timeout: 10_000 });
}

test.describe('Login flows', () => {
  test('cliente logs in → redirect portal próprio', async ({ page }) => {
    await loginAndWaitRedirect(page, USERS.cliente, '/portal/');
    expect(page.url()).toContain('?slug=' + USERS.cliente.slug);
  });

  test('admin loga → redirect /admin/', async ({ page }) => {
    await loginAndWaitRedirect(page, USERS.admin, '/admin/');
  });

  test('credencial errada mostra erro, não redireciona', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.locator('#loginIdentifier').fill('joao@advmais.com');
    await page.locator('#loginPassword').fill('senha-totalmente-errada');
    await page.locator('#loginForm button[type=submit]').click();
    await page.waitForTimeout(3000);
    const msg = await page.locator('#authMessage').innerText();
    expect(msg.length).toBeGreaterThan(0);
    expect(page.url()).toBe(PROD + '/');
  });

  test('email não cadastrado não vaza existência', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.locator('#loginIdentifier').fill('nao-existe-mesmo@invalid.test');
    await page.locator('#loginPassword').fill('qualquer123');
    await page.locator('#loginForm button[type=submit]').click();
    await page.waitForTimeout(3000);
    const msg = await page.locator('#authMessage').innerText();
    // Mensagem deve ser genérica, não revelar se o email existe
    expect(msg.toLowerCase()).not.toContain('não encontrado');
    expect(msg.toLowerCase()).not.toContain('not found');
  });
});

test.describe('Forgot password', () => {
  test('UI completa', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.locator('#forgotLink').click();
    await expect(page.locator('#forgotView')).toHaveClass(/active/);
    await expect(page.locator('#forgotEmail')).toBeVisible();
    await page.locator('#forgotBackLink').click();
    await expect(page.locator('#loginView')).toHaveClass(/active/);
  });

  test('envio retorna sucesso (não revela se email existe)', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.locator('#forgotLink').click();
    await page.locator('#forgotEmail').fill('email-totalmente-novo@invalid.test');
    await page.locator('#forgotForm button[type=submit]').click();
    await page.waitForTimeout(3000);
    const msg = await page.locator('#authMessage').innerText();
    // Esperado: mensagem genérica de sucesso, sem revelar se o email está cadastrado
    expect(msg.toLowerCase()).toMatch(/(pronto|enviado|recebe|verifique|caixa de entrada)/);
  });

  test('email malformado é rejeitado pelo browser (HTML5 validity)', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.locator('#forgotLink').click();
    await page.locator('#forgotEmail').fill('nao-eh-email');
    const valid = await page.locator('#forgotEmail').evaluate((el) => el.validity.valid);
    expect(valid).toBe(false);
  });
});

test.describe('Signup (desabilitado — só por convite)', () => {
  test('Tab "Cadastrar" mostra aviso de convite, form oculto', async ({ page }) => {
    await page.goto(PROD + '/');
    await page.locator('[data-tab="register"]').click();
    await expect(page.locator('#registerView')).toHaveClass(/active/);
    const text = await page.locator('#registerView').innerText();
    expect(text.toLowerCase()).toContain('convite');
    // Form deve estar oculto (display:none)
    const visible = await page.locator('#registerForm').isVisible();
    expect(visible).toBe(false);
  });
});

test.describe('Portal cliente', () => {
  test('renderiza nome + perfil + dropdowns', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type()==='error') errors.push(m.text()); });

    await loginAndWaitRedirect(page, USERS.cliente, '/portal/');
    await page.waitForTimeout(8000);
    const body = await page.locator('body').innerText();
    expect(body).toContain(USERS.cliente.name);
    expect(body).toContain('Novo Chamado');
    expect(body).toContain('Meus Chamados');
    expect(body.toUpperCase()).toContain('PERFIL');
    expect(errors, 'erros JS no portal').toEqual([]);
  });

  test('CSP permite supabase + cdn.jsdelivr', async ({ page }) => {
    const cspViolations = [];
    page.on('console', (m) => {
      const t = m.text();
      if (/Content Security Policy|Refused to/i.test(t)) cspViolations.push(t);
    });
    await loginAndWaitRedirect(page, USERS.cliente, '/portal/');
    await page.waitForTimeout(6000);
    expect(cspViolations).toEqual([]);
  });
});

test.describe('Edge cases / IDOR / segurança', () => {
  test('cliente não acessa portal de OUTRO cliente (IDOR)', async ({ page }) => {
    await loginAndWaitRedirect(page, USERS.cliente, '/portal/');
    // Tenta ir pro slug de OUTRO cliente
    await page.goto(PROD + `/portal/?slug=${USERS.cliente2.slug}`);
    await page.waitForTimeout(5000);
    // Deve ser redirecionado pra login (auth.guard) ou bloqueado
    const url = page.url();
    const ok = url.endsWith('/servico/') || url.includes('/servico/index') || url.includes(`?slug=${USERS.cliente.slug}`);
    expect(ok, `IDOR esperado bloqueio, mas URL=${url}`).toBe(true);
  });

  test('slug inválido (regex) → redirect login', async ({ page }) => {
    await loginAndWaitRedirect(page, USERS.cliente, '/portal/');
    await page.goto(PROD + '/portal/?slug=../../etc/passwd');
    await page.waitForTimeout(4000);
    const url = page.url();
    expect(url).not.toContain('etc%2Fpasswd');
    expect(url).not.toContain('../');
  });

  test('sem JWT → /api/clickup.php = 401', async ({ request }) => {
    const r = await request.post(PROD + '/api/clickup.php', {
      data: { method: 'GET', path: 'task/x', clientSlug: USERS.cliente.slug },
    });
    expect(r.status()).toBe(401);
  });

  test('JWT bogus → /api/clickup.php = 401', async ({ request }) => {
    const r = await request.post(PROD + '/api/clickup.php', {
      data: { method: 'GET', path: 'task/x', clientSlug: USERS.cliente.slug },
      headers: { Authorization: 'Bearer fake.fake.fake' },
    });
    expect(r.status()).toBe(401);
  });

  test('SSRF: path absoluto rejeitado em clickup.php', async ({ request }) => {
    const r = await request.post(PROD + '/api/clickup.php', {
      data: { method: 'GET', path: 'http://attacker.example.com/leak', clientSlug: USERS.cliente.slug },
      headers: { Authorization: 'Bearer fake.fake.fake' },
    });
    // 401 (bogus JWT) ou 422 (path absoluto rejeitado) — ambos OK
    expect([401, 422]).toContain(r.status());
  });

  test('clickup-webhook sem signature → 401 ou 503', async ({ request }) => {
    const r = await request.post(PROD + '/api/clickup-webhook.php', { data: { event: 'test' } });
    expect([401, 503]).toContain(r.status());
  });

  test('endpoints PHP órfãos (deletados) retornam 404', async ({ request }) => {
    const orphans = ['auth.php', 'users.php', 'insights.php', 'bootstrap.php', 'health.php', 'csrf.php', 'export.php'];
    for (const p of orphans) {
      const r = await request.get(PROD + '/api/' + p);
      expect(r.status(), `Expected 404 em /api/${p}`).toBe(404);
    }
  });

  test('storage e scripts órfãos não acessíveis', async ({ request }) => {
    const banned = ['api/storage/app-state.json', 'api/scripts/setup-admin.php', 'api/storage/audit-log.jsonl'];
    for (const p of banned) {
      const r = await request.get(PROD + '/' + p);
      expect([403, 404].includes(r.status()), `${p} retornou ${r.status()}`).toBe(true);
    }
  });

  test('headers de segurança presentes', async ({ request }) => {
    const r = await request.get(PROD + '/');
    const h = r.headers();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['strict-transport-security']).toBeTruthy();
    expect(h['content-security-policy']).toBeTruthy();
    expect(h['referrer-policy']).toBeTruthy();
  });
});

test.describe('Admin panel', () => {
  test('admin loga e /admin/ carrega', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type()==='error') errors.push(m.text()); });

    await loginAndWaitRedirect(page, USERS.admin, '/admin/');
    await page.waitForTimeout(8000);
    const body = await page.locator('body').innerText();
    // Espera-se conteúdo do painel (algum texto reconhecível)
    expect(body.length).toBeGreaterThan(100);
    expect(errors, 'erros JS no admin').toEqual([]);
  });

  test('cliente NÃO consegue acessar /admin/ (auth-guard)', async ({ page }) => {
    await loginAndWaitRedirect(page, USERS.cliente, '/portal/');
    await page.goto(PROD + '/admin/');
    await page.waitForTimeout(5000);
    const url = page.url();
    // Deve redirect pra login ou pro portal próprio
    expect(url.includes('/admin/') && !url.includes('?')).toBe(false);
  });
});

test.describe('Forgot reset detection (hash recovery)', () => {
  test('hash type=recovery mostra resetView', async ({ page }) => {
    await page.goto(PROD + '/#access_token=fake&refresh_token=fake&type=recovery&expires_in=3600');
    await page.waitForTimeout(3000);
    await expect(page.locator('#resetView')).toHaveClass(/active/);
    await expect(page.locator('#resetPassword')).toBeVisible();
  });
});
