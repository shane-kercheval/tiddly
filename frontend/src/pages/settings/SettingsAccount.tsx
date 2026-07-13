/**
 * Account settings page — Clerk's <UserProfile /> mounted in-app (Settings →
 * Account), rather than linking out to the hosted Account Portal, so users
 * stay inside the app consistent with the existing settings pattern.
 *
 * New capability, not parity (migration plan M3 step 9): password change and
 * session/device management never existed under Auth0, which ships no
 * end-user account UI.
 *
 * GUARD RAIL: do NOT expose an account-deletion section until deletion is
 * wired end-to-end (Clerk `user.deleted` webhook → backend cascade delete,
 * plan M8) — a Clerk-side deletion without the webhook orphans all the user's
 * data in Postgres. Whether the section appears is controlled Clerk-side
 * ("Allow users to delete their accounts" in the instance's user settings);
 * the dev-instance pass verifies it is off (ledger question 12 records what
 * the component and the hosted portal expose).
 *
 * In dev mode there is no Clerk context or account to manage; the page says so
 * instead of rendering the component.
 *
 * This file is one of the few allowed to import the Clerk SDK (see
 * eslint.config.js): it mounts prebuilt Clerk UI, which cannot be expressed
 * through the seam.
 */
import type { ReactNode } from 'react'
import { UserProfile } from '@clerk/clerk-react'
import { isDevMode } from '../../config'
import { usePageTitle } from '../../hooks/usePageTitle'

export function SettingsAccount(): ReactNode {
  usePageTitle('Settings')

  // No page header: <UserProfile /> renders its own "Account / Manage your
  // account info" heading, and duplicating it read as repetitive.
  return (
    <div className="pt-3">
      {isDevMode ? (
        <p className="text-sm text-yellow-700">
          Dev mode: authentication is bypassed, so there is no account to manage.
        </p>
      ) : (
        <UserProfile
          routing="hash"
          // Stretch to fill the settings column (merged with the global
          // appearance): Clerk's default fixed-width floating card read as an
          // embedded widget rather than a settings page.
          appearance={{
            elements: {
              rootBox: 'w-full',
              cardBox: 'w-full max-w-none',
            },
          }}
        />
      )}
    </div>
  )
}
