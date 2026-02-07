/**
 * Content type filter chips for selecting which content types to display.
 *
 * Renders clickable chips for each content type (Bookmarks, Notes, Prompts).
 * Multi-select behavior with at least one type required.
 */
import type { ReactNode } from 'react'
import { BookmarkIcon, NoteIcon, PromptIcon } from '../icons'
import { FilterChip } from './FilterChip'
import type { ContentType } from '../../types'

interface ContentTypeFilterChipsProps {
  /** Currently selected content types */
  selectedTypes: ContentType[]
  /** Available content types to display */
  availableTypes?: ContentType[]
  /** Callback when selection changes */
  onChange: (type: ContentType) => void
}

interface ChipConfig {
  label: string
  icon: ReactNode
}

const CHIP_CONFIGS: Record<ContentType, ChipConfig> = {
  bookmark: {
    label: 'Bookmarks',
    icon: <BookmarkIcon className="h-3.5 w-3.5" />,
  },
  note: {
    label: 'Notes',
    icon: <NoteIcon className="h-3.5 w-3.5" />,
  },
  prompt: {
    label: 'Prompts',
    icon: <PromptIcon className="h-3.5 w-3.5" />,
  },
}

export function ContentTypeFilterChips({
  selectedTypes,
  availableTypes,
  onChange,
}: ContentTypeFilterChipsProps): ReactNode {
  const resolvedTypes = (availableTypes && availableTypes.length > 0)
    ? availableTypes
    : (Object.keys(CHIP_CONFIGS) as ContentType[])
  const sortedTypes = [...resolvedTypes].sort((left, right) => (
    CHIP_CONFIGS[left].label.localeCompare(CHIP_CONFIGS[right].label)
  ))

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Show:</span>
      <div className="flex gap-1.5">
        {sortedTypes.map((type) => {
          const { label, icon } = CHIP_CONFIGS[type]
          const isSelected = selectedTypes.includes(type)
          const isOnlySelected = selectedTypes.length === 1 && isSelected

          return (
            <FilterChip
              key={type}
              label={label}
              icon={icon}
              selected={isSelected}
              disabled={isOnlySelected}
              onClick={() => onChange(type)}
            />
          )
        })}
      </div>
    </div>
  )
}
