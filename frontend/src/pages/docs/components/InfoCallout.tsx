import type { ReactNode } from 'react'
import { VARIANT_STYLES, type CalloutVariant } from './calloutStyles'

interface InfoCalloutProps {
  variant: CalloutVariant
  title?: string
  children: ReactNode
}

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
