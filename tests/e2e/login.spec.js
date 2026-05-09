/**
 * Smoke E2E — verifica que a página de login renderiza corretamente.
 *
 * Não submete o formulário (credenciais reais não disponíveis no CI).
 * Testes de fluxo completo de autenticação serão adicionados na Fase 1.
 */
import { test, expect } from '@playwright/test';

test.describe('Página de login', () => {
  test('renderiza campo de email e botão de acesso', async ({ page }) => {
    await page.goto('/');

    // Aguarda a página carregar completamente
    await page.waitForLoadState('networkidle');

    // Verifica campo de email
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="e-mail" i]');
    await expect(emailInput.first()).toBeVisible({ timeout: 10_000 });

    // Verifica botão de submit/login
    const submitBtn = page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar"), button:has-text("Login")');
    await expect(submitBtn.first()).toBeVisible({ timeout: 5_000 });
  });
});
