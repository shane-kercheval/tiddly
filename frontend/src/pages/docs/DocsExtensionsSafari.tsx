import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

export function DocsExtensionsSafari(): ReactNode {
  usePageTitle('Docs - Safari Extension')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Safari Extension</h1>
      <p className="text-gray-600 mb-8">
        A native Safari extension for macOS, iOS, and iPadOS.
      </p>

      <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-gray-50 py-16 px-8 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-200">
          <svg className="h-6 w-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Coming Soon</h2>
        <p className="text-sm text-gray-500 max-w-sm">
          Safari extension support for macOS, iOS, and iPadOS is in development.
          It will include the same save and search features as the Chrome extension.
        </p>
      </div>
    </div>
  )
}
