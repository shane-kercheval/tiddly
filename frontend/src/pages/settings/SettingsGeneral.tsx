/**
 * Settings page for General UI preferences.
 *
 * Allows users to configure layout and display options.
 */
import type { ReactNode } from 'react'
import { useUIPreferencesStore } from '../../stores/uiPreferencesStore'

/**
 * General settings page for UI preferences.
 */
export function SettingsGeneral(): ReactNode {
  const { fullWidthLayout, toggleFullWidthLayout } = useUIPreferencesStore()

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">General</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure display and layout preferences.
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
          <div className="flex items-center justify-between p-4">
            <div>
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
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                fullWidthLayout ? 'bg-blue-600' : 'bg-gray-200'
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
    </div>
  )
}
