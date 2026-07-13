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
    // Auth-provider seam boundary: SDK hooks/logic live ONLY in
    // AuthProvider.tsx (and its test, which mocks the SDK to test the seam
    // wiring itself); everything else consumes useAuthStatus()/useAuthActions(),
    // so swapping the provider touches one module. Two deliberate exceptions
    // for prebuilt provider UI that cannot be expressed through the seam:
    // SessionExpiredDialog (mounts <SignIn> for in-place re-auth) and
    // SettingsAccount (mounts <UserProfile />).
    files: ['**/*.{ts,tsx}'],
    ignores: [
      'src/components/AuthProvider.tsx',
      'src/components/AuthProvider.test.tsx',
      'src/components/SessionExpiredDialog.tsx',
      'src/components/SessionExpiredDialog.test.tsx',
      'src/pages/settings/SettingsAccount.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@clerk/clerk-react',
              message:
                'Import the auth seam (hooks/useAuthStatus, hooks/useAuthActions) instead — only AuthProvider.tsx (and the two prebuilt-UI mounts) may touch the provider SDK.',
            },
            {
              name: '@auth0/auth0-react',
              message:
                'Auth0 was removed in the Clerk migration (M3) — use the auth seam.',
            },
          ],
        },
      ],
    },
  },
])
