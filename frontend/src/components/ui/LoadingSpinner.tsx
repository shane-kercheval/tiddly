/**
 * Reusable loading spinner component.
 */
import type { ReactNode } from 'react'

type SpinnerSize = 'sm' | 'md' | 'lg'

interface LoadingSpinnerProps {
  /** Size of the spinner */
  size?: SpinnerSize
  /** Additional CSS classes */
  className?: string
  /** Accessible label for screen readers */
  label?: string
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'spinner-sm',
  md: 'spinner-md',
  lg: 'spinner-lg',
}

/**
 * Loading spinner with accessibility support.
 */
export function LoadingSpinner({
  size = 'md',
  className = '',
  label = 'Loading...',
}: LoadingSpinnerProps): ReactNode {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={className}
    >
      <div className={sizeClasses[size]} />
      <span className="sr-only">{label}</span>
    </div>
  )
}

/**
 * Page-level centered loading spinner.
 * Uses viewport-relative min-height to self-center without depending on parent flex layout.
 * Works both inside Layout (content area) and pre-Layout (full page).
 */
export function LoadingSpinnerPage({
  size = 'md',
  label = 'Loading...',
}: Omit<LoadingSpinnerProps, 'className'>): ReactNode {
  return (
    <div className="flex items-center justify-center min-h-[calc(100dvh_-_10rem)]">
      <LoadingSpinner size={size} label={label} />
    </div>
  )
}
