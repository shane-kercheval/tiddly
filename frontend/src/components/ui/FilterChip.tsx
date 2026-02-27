/**
 * FilterChip - A primitive chip component for filter UI.
 *
 * Pure UI component with no selection logic. Used by ContentTypeFilterChips
 * and directly in SettingsVersionHistory for consistent filter styling.
 */
import type { ReactNode } from 'react'

export interface FilterChipProps {
  /** Display label for the chip */
  label: string
  /** Whether the chip is currently selected */
  selected: boolean
  /** Click handler for toggling selection */
  onClick: () => void
  /** Optional icon to display before the label */
  icon?: ReactNode
  /** Whether the chip is disabled (e.g., can't deselect last item) */
  disabled?: boolean
}

export function FilterChip({
  label,
  selected,
  onClick,
  icon,
  disabled = false,
}: FilterChipProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-px text-xs font-medium transition-colors ${
        selected
          ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      {icon}
      <span>{label}</span>
      {selected && (
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </button>
  )
}
