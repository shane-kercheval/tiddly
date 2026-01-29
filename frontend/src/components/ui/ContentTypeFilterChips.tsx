/**
 * Content type filter chips for selecting which content types to display.
 *
 * Renders clickable chips for each content type (Bookmarks, Notes, Prompts).
 * Multi-select behavior with at least one type required.
 */
import type { ReactNode } from 'react'
import { BookmarkIcon, NoteIcon, PromptIcon } from '../icons'
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
  type: ContentType
  label: string
  icon: ReactNode
}

const CHIP_CONFIGS: Record<ContentType, ChipConfig> = {
  bookmark: {
    type: 'bookmark',
    label: 'Bookmarks',
    icon: <BookmarkIcon className="h-3.5 w-3.5" />,
  },
  note: {
    type: 'note',
    label: 'Notes',
    icon: <NoteIcon className="h-3.5 w-3.5" />,
  },
  prompt: {
    type: 'prompt',
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
            <button
              key={type}
              type="button"
              onClick={() => onChange(type)}
              disabled={isOnlySelected}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                isSelected
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
              } ${isOnlySelected ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              {icon}
              <span>{label}</span>
              {isSelected && (
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
        })}
      </div>
    </div>
  )
}
