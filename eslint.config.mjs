// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
    eslint.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    eslintConfigPrettier,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Hard requirement: the `!` non-null assertion operator must never compile.
            '@typescript-eslint/no-non-null-assertion': 'error',
            '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
            ],
        },
    },
    {
        files: ['**/*.mjs'],
        extends: [tseslint.configs.disableTypeChecked],
    },
    {
        files: ['**/*.test.ts'],
        rules: {
            '@typescript-eslint/unbound-method': 'off',
        },
    },
    {
        ignores: [
            '**/dist/',
            'coverage/',
            'scripts/',
            'vitest.config.ts',
            'packages/*/examples/',
            'packages/*/scripts/',
            'packages/native/prebuilt/',
        ],
    },
);
