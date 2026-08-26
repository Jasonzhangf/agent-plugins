import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['lib/**', 'node_modules/**', 'test-dist/**'],
    languageOptions: {
      globals: {
        console: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        window: 'readonly',
        AbortSignal: 'readonly',
        TextDecoder: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
)
