import js from '@eslint/js';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

export default [
  js.configs.recommended,
  sonarjs.configs.recommended,
  {
    files: ['assets/js/**/*.js', 'admin/assets/**/*.js', 'auth-guard.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        supabase: 'readonly',
        AdminAPI: 'readonly',
        PortalAuth: 'readonly',
        GP_API: 'readonly',
        GP_I18N: 'readonly',
        SUPABASE_CONFIG: 'readonly',
        getSupabaseClient: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'sonarjs/cognitive-complexity': ['warn', 20],
      'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-collapsible-if': 'warn',
      'sonarjs/prefer-immediate-return': 'warn',
      'sonarjs/pseudo-random': 'off', // mocks usam Math.random
      'sonarjs/todo-tag': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      '.quality/',
      'tests/',
      'scripts/',
      'docs/',
      'tmp/',
    ],
  },
];
