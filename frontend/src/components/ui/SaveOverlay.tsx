/**
 * SaveOverlay - Page-level overlay shown during save operations.
 *
 * Displays a centered spinner with blur backdrop over the main content area,
 * ensuring the user sees saving feedback regardless of scroll position.
 * Uses a portal to render into the main content container for full coverage.
 * Falls back to inline rendering if the portal target doesn't exist (e.g., in tests).
 */
import { createPortal } from 'react-dom'
import { LoadingSpinner } from './LoadingSpinner'

interface SaveOverlayProps {
  /** Whether the overlay should be visible */
  isVisible: boolean
  /** Label for screen readers, defaults to "Saving..." */
  label?: string
}

export function SaveOverlay({ isVisible, label = 'Saving...' }: SaveOverlayProps): React.ReactNode {
  if (!isVisible) return null

  const overlay = (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/35">
      <LoadingSpinner size="lg" label={label} />
    </div>
  )

  // Get the main content container for portal rendering (defined in Layout.tsx)
  const container = document.getElementById('main-content')

  // Use portal if container exists, otherwise render inline (for tests)
  return container ? createPortal(overlay, container) : overlay
}
