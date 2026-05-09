import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'build/coverage-js',
      include: ['*.js', 'admin/**/*.js'],
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
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
