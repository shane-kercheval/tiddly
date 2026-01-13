/**
 * SaveOverlay - Page-level overlay shown during save operations.
 *
 * Displays a centered spinner with blur backdrop over the content area,
 * ensuring the user sees saving feedback regardless of scroll position.
 */
import { LoadingSpinner } from './LoadingSpinner'

interface SaveOverlayProps {
  /** Whether the overlay should be visible */
  isVisible: boolean
  /** Label for screen readers, defaults to "Saving..." */
  label?: string
}

export function SaveOverlay({ isVisible, label = 'Saving...' }: SaveOverlayProps): React.ReactNode {
  if (!isVisible) return null

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/20 backdrop-blur-sm rounded-lg">
      <LoadingSpinner size="lg" label={label} />
    </div>
  )
}
