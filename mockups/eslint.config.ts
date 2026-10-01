import { tanstackConfig } from '@tanstack/eslint-config'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  globalIgnores(['eslint.config.ts', 'prettier.config.ts']),
])
