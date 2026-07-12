import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Auth-provider seam boundary: the IdP SDK may only be imported in
    // AuthProvider.tsx (and its test, which mocks the SDK to test the seam
    // wiring itself). Everything else consumes useAuthStatus()/useAuthActions(),
    // so swapping the provider touches exactly one module.
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/components/AuthProvider.tsx', 'src/components/AuthProvider.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@auth0/auth0-react',
              message:
                'Import the auth seam (hooks/useAuthStatus, hooks/useAuthActions) instead — only AuthProvider.tsx may touch the provider SDK.',
            },
          ],
        },
      ],
    },
  },
])
