/**
 * Reusable empty state component.
 */
import type { ReactNode } from 'react'

interface EmptyStateAction {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary'
}

interface EmptyStateProps {
  /** Icon to display (SVG element) */
  icon: ReactNode
  /** Main heading */
  title: string
  /** Optional description text — rendered only when non-empty. */
  description?: string
  /** Optional action button */
  action?: EmptyStateAction
  /** Optional action buttons */
  actions?: EmptyStateAction[]
  /**
   * Optional content rendered between description and actions — used for
   * actionable hints (M6) or contextual tip cards (M7 starter tips). Sits
   * above the action row so the explanatory copy precedes the buttons.
   */
  children?: ReactNode
  /**
   * Optional content rendered below the action row — for secondary affordances
   * that should follow the primary actions (e.g. a first-run "get oriented"
   * prompt beneath the "New …" buttons).
   */
  footer?: ReactNode
}

/**
 * Empty state display for when there's no data to show.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  actions,
  children,
  footer,
}: EmptyStateProps): ReactNode {
  const resolvedActions: EmptyStateAction[] = actions ?? (action ? [action] : [])

  return (
    <div className="py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center text-gray-300 [&>svg]:h-8 [&>svg]:w-8">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-medium text-gray-900">{title}</h3>
      {description !== undefined && description.length > 0 && (
        <p className="mt-1.5 text-sm text-gray-400">{description}</p>
      )}
      {children}
      {resolvedActions.length > 0 && (
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {resolvedActions.map((resolvedAction, index) => {
            const variant = resolvedAction.variant ?? 'secondary'
            const className = variant === 'primary' ? 'btn-primary' : 'btn-secondary'

            return (
              <button
                key={`${resolvedAction.label}-${index}`}
                onClick={resolvedAction.onClick}
                className={className}
              >
                {resolvedAction.label}
              </button>
            )
          })}
        </div>
      )}
      {footer}
    </div>
  )
}
