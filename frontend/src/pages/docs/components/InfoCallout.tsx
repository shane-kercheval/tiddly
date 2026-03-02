import type { ReactNode } from 'react'

interface InfoCalloutProps {
  variant: 'info' | 'warning' | 'tip'
  title?: string
  children: ReactNode
}

const VARIANT_STYLES = {
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  tip: 'bg-gray-50 border-gray-200 text-gray-700',
} as const

/**
 * Styled callout box for tips, notes, and warnings.
 */
export function InfoCallout({ variant, title, children }: InfoCalloutProps): ReactNode {
  return (
    <div className={`rounded-lg border p-4 ${VARIANT_STYLES[variant]}`}>
      {title && (
        <h4 className="text-sm font-semibold mb-2">{title}</h4>
      )}
      <div className="text-sm">{children}</div>
    </div>
  )
}
