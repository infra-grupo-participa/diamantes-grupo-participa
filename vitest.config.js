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
      // Only measure the pure/testable ESM modules (no DOM-heavy modules).
      // DOM-heavy modules (bootstrap, profiles, modals, task-cards) are covered by E2E.
      include: [
        'portal/assets/js/insights-utils.js',
        'portal/assets/js/insights-state.js',
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
