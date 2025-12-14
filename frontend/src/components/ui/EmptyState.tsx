/**
 * Reusable empty state component.
 */
import type { ReactNode } from 'react'

interface EmptyStateProps {
  /** Icon to display (SVG element) */
  icon: ReactNode
  /** Main heading */
  title: string
  /** Description text */
  description: string
  /** Optional action button */
  action?: {
    label: string
    onClick: () => void
  }
}

/**
 * Empty state display for when there's no data to show.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps): ReactNode {
  return (
    <div className="py-16 text-center">
      <div className="mx-auto h-10 w-10 text-gray-300">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-medium text-gray-900">{title}</h3>
      <p className="mt-1.5 text-sm text-gray-400">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="btn-primary mt-6"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
