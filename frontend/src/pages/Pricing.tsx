import type { ReactNode } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'

/**
 * Pricing page - placeholder during beta.
 */
export function Pricing(): ReactNode {
  usePageTitle('Pricing')
  return (
    <div className="text-center py-16">
      <h1 className="text-3xl font-bold text-gray-900">Pricing</h1>
      <p className="mt-4 text-lg text-gray-600">
        Tiddly is free during beta.
      </p>
      <p className="mt-2 text-gray-500">
        Pricing details will be announced well in advance of any changes.
        Existing users may be grandfathered.
      </p>
    </div>
  )
}
