/**
 * authenticated.spec.js — E2E do FLUXO LOGADO do novo modelo (gate → briefing básico →
 * projeto/evento → briefing projeto; + admin vê o projeto).
 *
 * Usa um cliente de teste semeado ('e2e-bot') + admin de teste. Requer a service-role key
 * em C:/tmp/sr.txt para resetar o estado do e2e-bot antes de cada execução (idempotente).
 * Se a chave não estiver presente, os testes são SKIPADOS (suíte segura sem o segredo).
 *
 * ⚠️ Escreve em produção (não há staging). Limitado ao slug namespaced 'e2e-bot'.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

const SB_URL = 'https://npqyvjhvtfahuxfmuhie.supabase.co';
const SR = existsSync('C:/tmp/sr.txt') ? readFileSync('C:/tmp/sr.txt', 'utf8').trim() : null;
const SLUG = 'e2e-bot';
const CLIENT = { email: 'e2e-bot@diamantes.test', password: 'E2eBot@2026Test' };
const ADMIN = { email: 'e2e-admin@diamantes.test', password: 'E2eAdmin@2026Test' };

const skip = !SR;

async function srDelete(path) {
  await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Profile': 'portal', Prefer: 'return=minimal' },
  });
}

test.beforeAll(async () => {
  if (skip) return;
  // reset estado do e2e-bot → gate volta a ativo
  await srDelete(`demands?client_slug=eq.${SLUG}`);
  await srDelete(`projects?client_slug=eq.${SLUG}`);
  await srDelete(`client_briefing?client_slug=eq.${SLUG}`);
});

async function login(page, u) {
  await page.goto('/');
  await page.locator('#loginIdentifier').fill(u.email);
  await page.locator('#loginPassword').fill(u.password);
  await page.locator('#loginForm button[type=submit]').click();
}

// Preenche genericamente todos os campos editáveis visíveis da tela de briefing.
async function fillAllFields(page) {
  // 1) toggles boolean → "Sim" (revela dependentes)
  const sims = page.locator('.toggle-btn', { hasText: /^Sim$/ });
  const ns = await sims.count();
  for (let i = 0; i < ns; i++) { const b = sims.nth(i); if (await b.isVisible()) await b.click().catch(() => {}); }
  await page.waitForTimeout(200);
  // 2) inputs/selects editáveis
  const inputs = page.locator('.field-input:not([readonly])');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    if (!await el.isVisible()) continue;
    const tag = await el.evaluate(e => e.tagName);
    if (tag === 'SELECT') {
      const opts = await el.locator('option').count();
      if (opts > 1) await el.selectOption({ index: 1 }).catch(() => {});
    } else {
      const id = (await el.getAttribute('id')) || '';
      const type = (await el.getAttribute('type')) || 'text';
      let v;
      if (id.startsWith('cl-')) v = '4242';            // cartão: últimos 4
      else if (id.startsWith('ce-')) v = '1230';       // cartão: validade → 12/30
      else v = type === 'date' ? '2026-12-01' : type === 'url' ? 'https://teste.test'
        : type === 'number' ? '1000' : type === 'email' ? 'x@teste.test' : 'teste';
      await el.fill(v).catch(() => {});
    }
  }
}

test.describe('Fluxo logado — cliente', () => {
  test.skip(skip, 'service-role ausente (C:/tmp/sr.txt) — seed/reset indisponível');

  test('gate: cliente sem Briefing Básico vê banner e bloqueio', async ({ page }) => {
    await login(page, CLIENT);
    await page.waitForURL('**/portal/**', { timeout: 15000 });
    await expect(page.locator('#gateBanner')).toBeVisible({ timeout: 10000 });
    // novo-projeto bloqueado
    await page.goto('/portal/novo-projeto.html');
    await expect(page.locator('#gate')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#content')).toBeHidden();
  });

  test('Briefing Básico: preenche acessos + envia → libera portal', async ({ page }) => {
    await login(page, CLIENT);
    await page.waitForURL('**/portal/**', { timeout: 15000 });
    await page.goto('/portal/briefing-basico.html');
    await expect(page.locator('#sec-me')).toBeVisible({ timeout: 10000 }); // dados pessoais read-only
    await page.waitForTimeout(800); // render das seções de serviço
    await fillAllFields(page);
    await page.locator('#btnSubmit').click();
    await expect(page.locator('#submittedBanner')).toBeVisible({ timeout: 15000 });
    // gate liberado: novo-projeto agora mostra conteúdo
    await page.goto('/portal/novo-projeto.html');
    await expect(page.locator('#content')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#serviceGrid .service-card')).not.toHaveCount(0);
  });

  test('Projeto/evento: cria + briefing mostra geral + serviços + acessos herdados', async ({ page }) => {
    await login(page, CLIENT);
    await page.waitForURL('**/portal/**', { timeout: 15000 });
    await page.goto('/portal/novo-projeto.html');
    await expect(page.locator('#content')).toBeVisible({ timeout: 10000 });
    await page.locator('#projectTitle').fill('Evento E2E ' + Date.now());
    await page.locator('#btnCreate').click();
    await page.waitForURL('**/briefing.html?projeto=**', { timeout: 15000 });
    // bloco geral + ao menos uma seção de serviço + uma seção de acesso herdado (read-only)
    await expect(page.locator('#sections')).toContainText('Dados do evento', { timeout: 10000 });
    await expect(page.locator('.section-panel.access')).not.toHaveCount(0);
    await expect(page.locator('.readonly-badge').first()).toBeVisible();
    // preenche e envia
    await fillAllFields(page);
    await page.locator('#btnSubmit').click();
    await expect(page.locator('#submittedBanner')).toBeVisible({ timeout: 20000 });
  });

  test('Demandas: gate liberado, modal abre nos 2 modos', async ({ page }) => {
    await login(page, CLIENT);
    await page.waitForURL('**/portal/**', { timeout: 15000 });
    await page.goto('/portal/demandas.html');
    // abre "Nova demanda" (gate já liberado pelos testes anteriores)
    const novo = page.locator('text=Nova demanda').first();
    if (await novo.count()) await novo.click().catch(() => {});
    // modo simples + por projeto presentes
    await expect(page.locator('.nd-mode-card[data-mode="simple"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.nd-mode-card[data-mode="project"]')).toBeVisible();
  });
});

test.describe('Fluxo logado — admin', () => {
  test.skip(skip, 'service-role ausente');

  test('admin loga → /admin/', async ({ page }) => {
    await login(page, ADMIN);
    await page.waitForURL('**/admin/**', { timeout: 15000 });
    expect(page.url()).toContain('/admin/');
  });

  test('admin/projetos lista o projeto do e2e-bot + modal de briefing', async ({ page }) => {
    await login(page, ADMIN);
    await page.waitForURL('**/admin/**', { timeout: 15000 });
    await page.goto('/admin/projetos.html');
    await expect(page.locator('#tableBody')).toContainText('Evento E2E', { timeout: 12000 });
    await page.locator('.btn-view[data-project-id]').first().click();
    await expect(page.locator('#briefingModal')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#modalBody')).toContainText('Dados do evento');
  });

  test('ONB: alunos-diamantes tem botão Gerar acesso', async ({ page }) => {
    await login(page, ADMIN);
    await page.waitForURL('**/admin/**', { timeout: 15000 });
    await page.goto('/admin/alunos-diamantes.html');
    await expect(page.locator('[data-action="access"]').first()).toBeVisible({ timeout: 12000 });
  });
});
