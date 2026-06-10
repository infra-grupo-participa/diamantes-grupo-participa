import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'build/coverage-js',
      // Mede a lógica pura nova do briefing (helpers de scope/validação).
      // Telas DOM-heavy são cobertas por E2E (Playwright).
      include: [
        'portal/assets/briefing-templates.js',
      ],
      exclude: [
        'vendor/**',
        'node_modules/**',
        'tests/**',
        'build/**',
        'coverage/**',
        '.github/**',
        '**/*.config.js',
      ],
      thresholds: {
        lines: 30,
        functions: 30,
        branches: 30,
        statements: 30,
      },
    },
  },
});
