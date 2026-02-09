/**
 * MultiSelectDropdown - A dropdown with checkboxes for multi-select filtering.
 *
 * Shows a trigger button that opens a dropdown with checkbox options.
 * Displays count of selected items when filtered, or "All" when nothing selected.
 */
import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'

export interface DropdownOption<T extends string> {
  /** The value used for filtering */
  value: T
  /** Display label shown in the dropdown */
  label: string
  /** Optional icon to show before the label */
  icon?: ReactNode
}

export interface MultiSelectDropdownProps<T extends string> {
  /** Label shown on the dropdown trigger (e.g., "Type", "Action") */
  label: string
  /** Available options to select from */
  options: DropdownOption<T>[]
  /** Currently selected values */
  selected: T[]
  /** Callback when selection changes (passes the toggled value) */
  onChange: (value: T) => void
  /** Callback when "Select all" or "Deselect all" is clicked */
  onToggleAll?: (selectAll: boolean) => void
  /** Test ID for the dropdown trigger */
  testId?: string
}

export function MultiSelectDropdown<T extends string>({
  label,
  options,
  selected,
  onChange,
  onToggleAll,
  testId,
}: MultiSelectDropdownProps<T>): ReactNode {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const allSelected = selected.length === options.length
  const noneSelected = selected.length === 0

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Close menu when pressing escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
    }

    return (): void => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const hasSelection = selected.length > 0
  const displayLabel = hasSelection ? `${label} (${selected.length})` : label

  // Base styles matching the app's select dropdowns (h-[30px] target)
  const baseStyles = "appearance-none cursor-pointer rounded-lg border px-2.5 py-1 pr-7 text-sm focus:outline-none focus:ring-2 bg-[length:1rem_1rem] bg-[right_0.375rem_center] bg-no-repeat transition-colors"

  // Chevron SVG as background (matching native select styling)
  const chevronBg = "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')]"
  const chevronBgActive = "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%231d4ed8%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')]"

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`${baseStyles} ${
          hasSelection
            ? `border-blue-200 bg-blue-50/50 text-blue-700 focus:border-blue-300 focus:ring-blue-900/5 ${chevronBgActive}`
            : `border-gray-200 bg-gray-50/50 text-gray-700 focus:border-gray-300 focus:ring-gray-900/5 ${chevronBg}`
        }`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        data-testid={testId}
      >
        {displayLabel}
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full z-20 mt-1 min-w-[160px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          role="listbox"
          aria-multiselectable="true"
          data-testid={testId ? `${testId}-menu` : undefined}
        >
          {/* Select all / Deselect all toggle */}
          {onToggleAll && (
            <>
              <button
                type="button"
                onClick={() => onToggleAll(noneSelected || !allSelected)}
                className="flex w-full items-center gap-2 px-3 py-[5px] text-sm text-blue-600 hover:bg-gray-100"
                data-testid={testId ? `${testId}-toggle-all` : undefined}
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
              <div className="my-1 border-t border-gray-100" />
            </>
          )}
          {options.map((option) => {
            const isSelected = selected.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onChange(option.value)}
                className="flex w-full items-center gap-2 px-3 py-[5px] text-sm text-gray-700 hover:bg-gray-100"
                data-testid={testId ? `${testId}-option-${option.value}` : undefined}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    isSelected
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : 'border-gray-300 bg-white'
                  }`}
                >
                  {isSelected && (
                    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </span>
                {option.icon}
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
