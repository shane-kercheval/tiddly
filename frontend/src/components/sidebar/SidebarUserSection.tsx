/**
 * Logout button at the bottom of the sidebar.
 */
import { useAuth0 } from '@auth0/auth0-react'
import type { ReactNode } from 'react'
import { isDevMode } from '../../config'

interface SidebarUserSectionProps {
  isCollapsed: boolean
}

function LogoutIcon(): ReactNode {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"
      />
    </svg>
  )
}

export function SidebarUserSection({ isCollapsed }: SidebarUserSectionProps): ReactNode {
  // In dev mode, show button but don't use Auth0
  if (isDevMode) {
    return (
      <button
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 ${
          isCollapsed ? 'justify-center' : ''
        }`}
        title="Log out"
      >
        <LogoutIcon />
        {!isCollapsed && <span>Log out</span>}
      </button>
    )
  }

  return <LogoutButton isCollapsed={isCollapsed} />
}

function LogoutButton({ isCollapsed }: SidebarUserSectionProps): ReactNode {
  const { logout } = useAuth0()

  const handleLogout = (): void => {
    logout({ logoutParams: { returnTo: window.location.origin } })
  }

  return (
    <button
      onClick={handleLogout}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 ${
        isCollapsed ? 'justify-center' : ''
      }`}
      title="Log out"
    >
      <LogoutIcon />
      {!isCollapsed && <span>Log out</span>}
    </button>
  )
}
