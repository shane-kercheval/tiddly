/**
 * Inline editable archive schedule component.
 *
 * Displays archive schedule in view mode (showing date or "None") until clicked,
 * then shows dropdown with preset options and optional custom date picker.
 *
 * Features:
 * - View mode shows current schedule as text
 * - Click to edit reveals preset dropdown
 * - Custom date option shows datetime-local input
 * - Looks integrated with other inline editable components
 */
import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { calculateArchivePresetDate } from '../utils'
import type { ArchivePreset } from '../utils'

interface InlineEditableArchiveScheduleProps {
  /** Current archived_at ISO string or empty */
  value: string
  /** Called when archive date changes */
  onChange: (value: string) => void
  /** Current preset selection */
  preset: ArchivePreset
  /** Called when preset changes */
  onPresetChange: (preset: ArchivePreset) => void
  /** Whether the input is disabled */
  disabled?: boolean
}

/**
 * Convert ISO string to datetime-local format for input element.
 */
function toDatetimeLocalFormat(isoString: string): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

/**
 * Convert datetime-local format to ISO string.
 */
function fromDatetimeLocalFormat(localString: string): string {
  if (!localString) return ''
  return new Date(localString).toISOString()
}

/**
 * Format a date for display in view mode.
 */
function formatScheduleDisplay(isoString: string): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * InlineEditableArchiveSchedule displays archive schedule with inline editing.
 */
export function InlineEditableArchiveSchedule({
  value,
  onChange,
  preset,
  onPresetChange,
  disabled = false,
}: InlineEditableArchiveScheduleProps): ReactNode {
  const [isEditing, setIsEditing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsEditing(false)
      }
    }

    if (isEditing) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isEditing])

  const handlePresetChange = (newPreset: ArchivePreset): void => {
    onPresetChange(newPreset)

    if (newPreset === 'none') {
      onChange('')
    } else if (newPreset === 'custom') {
      // Keep current date or set a default future date
      const currentDate = value || calculateArchivePresetDate('1-week')
      onChange(currentDate)
    } else {
      // Calculate date from preset
      const calculatedDate = calculateArchivePresetDate(newPreset)
      onChange(calculatedDate)
    }

    // Close after selection (unless custom, which needs date input)
    if (newPreset !== 'custom') {
      setIsEditing(false)
    }
  }

  const handleCustomDateChange = (localString: string): void => {
    onChange(fromDatetimeLocalFormat(localString))
  }

  const handleViewClick = (): void => {
    if (!disabled) {
      setIsEditing(true)
    }
  }

  // View mode display text
  const displayText = value ? `Auto-archive: ${formatScheduleDisplay(value)}` : 'Auto-archive: None'

  if (isEditing) {
    return (
      <div ref={containerRef} className="relative inline-block">
        <div className="flex flex-col gap-2 p-2 bg-white border border-gray-200 rounded-lg shadow-sm min-w-[200px]">
          <select
            value={preset}
            onChange={(e) => handlePresetChange(e.target.value as ArchivePreset)}
            disabled={disabled}
            className="text-xs px-2 py-1.5 bg-gray-50 border border-gray-200 rounded outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400/20"
            autoFocus
          >
            <option value="none">None</option>
            <option value="1-week">In 1 week</option>
            <option value="1-month">In 1 month</option>
            <option value="end-of-month">End of month</option>
            <option value="3-months">In 3 months</option>
            <option value="6-months">In 6 months</option>
            <option value="1-year">In 1 year</option>
            <option value="custom">Custom date...</option>
          </select>

          {preset === 'custom' && (
            <input
              type="datetime-local"
              value={toDatetimeLocalFormat(value)}
              onChange={(e) => handleCustomDateChange(e.target.value)}
              disabled={disabled}
              className="text-xs px-2 py-1.5 bg-gray-50 border border-gray-200 rounded outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400/20"
            />
          )}

          {value && preset !== 'custom' && (
            <p className="text-xs text-gray-500">
              {formatScheduleDisplay(value)}
            </p>
          )}

          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="text-xs text-gray-500 hover:text-gray-700 self-end"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={handleViewClick}
      disabled={disabled}
      className={`
        inline-flex items-center gap-1 text-xs text-gray-500
        hover:text-gray-700 hover:bg-gray-100 rounded px-1.5 py-0.5
        transition-colors
        ${disabled ? 'cursor-not-allowed opacity-60' : ''}
      `}
    >
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <span>{displayText}</span>
    </button>
  )
}
