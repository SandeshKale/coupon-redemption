// @ts-check
import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.stryker-tmp/**',
      'supabase/**',
      'load/**',
      'reports/**',
      'playwright-report/**',
      '**/*.config.js',
      '**/*.config.ts',
      'apps/web/public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    settings: { 'import-x/resolver': { typescript: true, node: true } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': 'error',
      eqeqeq: 'error',
      complexity: ['error', 12],
      'max-depth': ['error', 3],
      'max-lines-per-function': ['error', { max: 80, skipComments: true, skipBlankLines: true }],
      'import-x/no-cycle': 'error',
      'import-x/order': ['error', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
      // Object-injection fires on every typed record lookup; TS index types cover it.
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    settings: { react: { version: '19.0' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.strict.rules,
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: false,
          ignoreProps: true,
          allowedStrings: ['₹', '·', '✓', '✕', '⟳', '⚑', '–', '—', '/', ':', '(', ')', '…'],
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message: 'Use src/lib/api (thin client) on dealer routes.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/scripts/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'security/detect-non-literal-fs-filename': 'off' },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'react/jsx-no-literals': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
