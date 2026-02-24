/**
 * View state filter chips for toggling Active/Archived in search results.
 *
 * Renders clickable chips for each view option.
 * Multi-select behavior with at least one view required.
 */
import type { ReactNode } from 'react'
import { FilterChip } from './FilterChip'

type ViewChipOption = 'active' | 'archived'

interface ViewFilterChipsProps {
  /** Currently selected views */
  selectedViews: ViewChipOption[]
  /** Callback when a view chip is toggled */
  onChange: (view: ViewChipOption) => void
}

const CHIP_CONFIGS: { value: ViewChipOption; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
]

export function ViewFilterChips({
  selectedViews,
  onChange,
}: ViewFilterChipsProps): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-xs text-gray-500">Include:</span>
      <div className="flex flex-wrap gap-1.5">
        {CHIP_CONFIGS.map(({ value, label }) => {
          const isSelected = selectedViews.includes(value)
          const isOnlySelected = selectedViews.length === 1 && isSelected

          return (
            <FilterChip
              key={value}
              label={label}
              selected={isSelected}
              disabled={isOnlySelected}
              onClick={() => onChange(value)}
            />
          )
        })}
      </div>
    </div>
  )
}
