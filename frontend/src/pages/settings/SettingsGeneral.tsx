/**
 * Settings page for General UI preferences.
 *
 * Allows users to configure layout and display options.
 */
import type { ReactNode } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { useUIPreferencesStore } from '../../stores/uiPreferencesStore'
import { useLimits } from '../../hooks/useLimits'
import { isDevMode } from '../../config'

/**
 * General settings page for UI preferences.
 */
export function SettingsGeneral(): ReactNode {
  const { fullWidthLayout, toggleFullWidthLayout } = useUIPreferencesStore()
  const { user } = useAuth0()
  const { limits, isLoading: isLoadingLimits, error: limitsError } = useLimits()

  return (
    <div className="max-w-3xl pt-4">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">General</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure display and layout preferences.
        </p>
      </div>

      {/* Keyboard Shortcuts Note */}
      <div className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-600">
          Press <kbd className="rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-xs">⌘+/</kbd> anywhere to view all keyboard shortcuts.
        </p>
      </div>

      {/* Layout Section */}
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Layout</h2>
          <p className="mt-1 text-sm text-gray-500">
            Customize how content is displayed.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-gray-900">Full-width layout</h3>
              <p className="text-sm text-gray-500">
                Expand content to fill the available width instead of using a constrained column.
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Keyboard shortcut: <kbd className="rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-xs">w</kbd>
              </p>
            </div>
            <button
              onClick={toggleFullWidthLayout}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                fullWidthLayout ? 'bg-brand-bookmark' : 'bg-gray-200'
              }`}
              role="switch"
              aria-checked={fullWidthLayout}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  fullWidthLayout ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Account Section */}
      <div className="mt-8 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Account</h2>
          <p className="mt-1 text-sm text-gray-500">
            Your account information.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between p-4">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Logged in as</h3>
              {isDevMode ? (
                <p className="text-sm text-yellow-700 font-medium">Dev User</p>
              ) : (
                <p className="text-sm text-gray-500">{user?.email}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Plan & Limits Section */}
      <div className="mt-8 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Plan & Limits</h2>
          <p className="mt-1 text-sm text-gray-500">
            Your current plan and usage limits.
          </p>
        </div>

        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">
            <span className="font-medium">Beta:</span> This app is currently in beta. Pricing tiers and limits have not been finalized and may change.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white">
          {isLoadingLimits ? (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
            </div>
          ) : limitsError ? (
            <div className="p-4 text-sm text-red-600">
              Failed to load limits. Please refresh the page to try again.
            </div>
          ) : limits ? (
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Current Plan:</span>
                <span className="font-medium capitalize">{limits.tier}</span>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 font-medium text-gray-900">Resource</th>
                      <th className="text-right py-2 font-medium text-gray-900">Limit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    <tr>
                      <td className="py-2 text-gray-600">Bookmarks</td>
                      <td className="py-2 text-right text-gray-900">{limits.max_bookmarks.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-gray-600">Notes</td>
                      <td className="py-2 text-right text-gray-900">{limits.max_notes.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-gray-600">Prompts</td>
                      <td className="py-2 text-right text-gray-900">{limits.max_prompts.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-gray-600">Bookmark content</td>
                      <td className="py-2 text-right text-gray-900">{limits.max_bookmark_content_length.toLocaleString()} chars</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-gray-600">Note content</td>
                      <td className="py-2 text-right text-gray-900">{limits.max_note_content_length.toLocaleString()} chars</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-gray-600">Prompt content</td>
                      <td className="py-2 text-right text-gray-900">{limits.max_prompt_content_length.toLocaleString()} chars</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-4 text-sm text-gray-500">
              Unable to load limits.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
