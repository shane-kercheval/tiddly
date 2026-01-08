/**
 * Inline editable title component.
 *
 * Displays as styled text but is actually an input that can be edited.
 * Used for note titles, prompt names, etc. where the field should look
 * like view-mode text but be directly editable.
 */
import { useId } from 'react'
import type { ReactNode, ChangeEvent, KeyboardEvent } from 'react'

interface InlineEditableTitleProps {
  /** Current value */
  value: string
  /** Called when value changes */
  onChange: (value: string) => void
  /** Placeholder text shown when empty */
  placeholder?: string
  /** Whether the field is required (shows visual indicator) */
  required?: boolean
  /** Whether the input is disabled */
  disabled?: boolean
  /** Typography variant: 'title' for large bold, 'name' for monospace */
  variant?: 'title' | 'name'
  /** Additional CSS classes */
  className?: string
  /** Called when Enter is pressed */
  onEnter?: () => void
  /** Error message to display */
  error?: string
}

/**
 * InlineEditableTitle renders as styled text that's directly editable.
 *
 * Uses a native <input> element styled to look like plain text:
 * - No visible border or background until focused
 * - Typography matches the variant (title = h1 style, name = monospace)
 * - Subtle focus ring on focus
 * - Full accessibility with native input behavior
 */
export function InlineEditableTitle({
  value,
  onChange,
  placeholder = 'Title',
  required = false,
  disabled = false,
  variant = 'title',
  className = '',
  onEnter,
  error,
}: InlineEditableTitleProps): ReactNode {
  const errorId = useId()

  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    onChange(e.target.value)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && onEnter) {
      e.preventDefault()
      onEnter()
    }
  }

  // Build class string based on variant and state
  const inputClasses = [
    // Remove default input appearance
    'bg-transparent border-none outline-none w-full',
    // Subtle hover/focus indicator
    'hover:ring-2 hover:ring-gray-900/5 focus:ring-2 focus:ring-gray-900/5 rounded px-1 -mx-1',
    // Placeholder styling
    'placeholder:text-gray-400',
    // Typography based on variant
    variant === 'name'
      ? 'font-mono text-lg text-gray-900'
      : 'text-2xl font-bold text-gray-900',
    // Error state
    error ? 'ring-2 ring-red-200' : '',
    // Disabled state
    disabled ? 'cursor-not-allowed opacity-60' : '',
    // Custom classes
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="w-full">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-required={required}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className={inputClasses}
      />
      {error && <p id={errorId} className="mt-1 text-sm text-red-500">{error}</p>}
    </div>
  )
}
