/**
 * Auth-aware "Save a copy" control for the public read view.
 *
 * Three states, driven by Auth0 init status:
 * - initializing  → neutral placeholder (avoids a flash of the wrong button)
 * - authenticated → "Save a copy" (clones via the M4 endpoint, then navigates)
 * - anonymous     → "Sign in to save a copy" (Auth0 login, returning to this URL)
 *
 * Safe on public routes: `AuthProvider` wraps the whole app tree, so
 * `useAuthStatus()` resolves everywhere. `useAuth0()` is only ever called from
 * the anonymous branch, which never renders in dev mode (where the user is
 * always "authenticated") — mirroring the isolation pattern in PublicHeader.
 */
import type { ReactNode } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { useLocation } from 'react-router-dom'
import { useAuthStatus } from '../hooks/useAuthStatus'
import { useSavePublicItem } from '../hooks/useSavePublicItem'

type PublicItemType = 'bookmarks' | 'notes' | 'prompts'

interface SaveACopyProps {
  type: PublicItemType
  token: string
}

/**
 * Anonymous-visitor button: sends the user through Auth0 login and returns them
 * to the current shared URL via `appState.returnTo` (sanitized in AuthProvider's
 * onRedirectCallback).
 */
function SignInToSave(): ReactNode {
  const { loginWithRedirect } = useAuth0()
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}`

  return (
    <button
      type="button"
      onClick={() =>
        loginWithRedirect({
          appState: { returnTo },
          authorizationParams: { screen_hint: 'login' },
        })
      }
      className="btn-secondary whitespace-nowrap"
    >
      Sign in to save
    </button>
  )
}

export function SaveACopy({ type, token }: SaveACopyProps): ReactNode {
  const { isAuthenticated, isLoading } = useAuthStatus()
  const save = useSavePublicItem(type, token)

  if (isLoading) {
    // Neutral placeholder while Auth0 initializes — same footprint as the button.
    return <div className="h-9 w-36 animate-pulse rounded-lg bg-gray-100" aria-hidden="true" />
  }

  if (!isAuthenticated) {
    return <SignInToSave />
  }

  return (
    <button
      type="button"
      onClick={() => save.mutate()}
      disabled={save.isPending}
      className="btn-secondary whitespace-nowrap"
    >
      {save.isPending ? 'Saving…' : 'Save to Tiddly'}
    </button>
  )
}
