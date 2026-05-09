import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',

  // Sobe o PHP built-in server antes de rodar os testes.
  // php deve estar disponível no PATH do runner (GitHub Actions instala na etapa de setup).
  webServer: {
    // GP_COOKIE_SECURE=false: PHP dev server runs over HTTP. Secure cookie flag must
    // be disabled so session cookies are sent/received correctly in tests.
    command: 'php -S 127.0.0.1:8765 -t .',
    url: 'http://127.0.0.1:8765',
    timeout: 15_000,
    reuseExistingServer: !process.env.CI,
    env: {
      GP_COOKIE_SECURE: 'false',
    },
  },

  use: {
    baseURL: 'http://127.0.0.1:8765',
    // Não salva vídeo/screenshot a menos que o teste falhe
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    // Apenas Chromium por enquanto — mais rápido no CI.
    // Firefox e WebKit serão adicionados na Fase 3+.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
