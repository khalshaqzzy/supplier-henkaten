import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const crossWorkspaceRelativePatterns = [
  '**/apps/**',
  '**/packages/**',
  '../../apps/**',
  '../../packages/**',
  '../../../apps/**',
  '../../../packages/**',
];

export default tseslint.config(
  {
    ignores: [
      '.agent/**',
      'docs/**',
      'materials/**',
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'uploads/**',
      'apps/api/*.config.ts',
      'pnpm-lock.yaml',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: crossWorkspaceRelativePatterns,
              message: 'Import another workspace through its @tmmin-henkaten package export.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/contracts/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tmmin-henkaten/api',
              message: 'Contracts cannot depend on an application.',
            },
            {
              name: '@tmmin-henkaten/test-fixtures',
              message: 'Contracts cannot depend on test fixtures.',
            },
          ],
          patterns: [
            {
              group: crossWorkspaceRelativePatterns,
              message: 'Contracts must not cross workspace boundaries with relative imports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/test-fixtures/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tmmin-henkaten/api',
              message: 'Test fixtures cannot depend on the API application.',
            },
          ],
          patterns: [
            {
              group: crossWorkspaceRelativePatterns,
              message: 'Test fixtures must use package exports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tmmin-henkaten/test-fixtures',
              message: 'Production API source cannot import test fixtures.',
            },
          ],
          patterns: [
            {
              group: crossWorkspaceRelativePatterns,
              message: 'API source must use package exports.',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
