/**
 * Inline editable text component.
 *
 * Displays as styled text but is actually a textarea that can be edited.
 * Used for descriptions and similar fields where the text should look
 * like view-mode content but be directly editable.
 *
 * Features:
 * - Auto-resizes to fit content when multiline
 * - Styled to look like plain text (no visible border/background)
 * - Supports placeholder text
 * - Optional character limit with counter
 * - Error state with accessible error message
 */
import { useEffect, useRef, useId } from 'react'
import type { ReactNode, ChangeEvent } from 'react'

interface InlineEditableTextProps {
  /** Current value */
  value: string
  /** Called when value changes */
  onChange: (value: string) => void
  /** Placeholder text shown when empty */
  placeholder?: string
  /** Whether the input is disabled */
  disabled?: boolean
  /** Whether to allow multiple lines (enables auto-resize) */
  multiline?: boolean
  /** Maximum character length */
  maxLength?: number
  /** Additional CSS classes */
  className?: string
  /** Typography variant: 'description' for italic gray, 'body' for normal */
  variant?: 'description' | 'body'
  /** Error message to display */
  error?: string
}

/**
 * InlineEditableText renders as styled text that's directly editable.
 *
 * Uses a native <textarea> element styled to look like plain text:
 * - No visible border or background until focused
 * - Auto-resizes height to fit content when multiline
 * - Subtle focus ring on focus
 * - Full accessibility with native textarea behavior
 */
export function InlineEditableText({
  value,
  onChange,
  placeholder = 'Add a description...',
  disabled = false,
  multiline = true,
  maxLength,
  className = '',
  variant = 'description',
  error,
}: InlineEditableTextProps): ReactNode {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const errorId = useId()

  // Auto-resize textarea to fit content
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea && multiline) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto'
      // Set height to scrollHeight to fit content
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [value, multiline])

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const newValue = e.target.value
    // Enforce maxLength if specified
    if (maxLength && newValue.length > maxLength) {
      return
    }
    onChange(newValue)
  }

  // Build class string based on variant and state
  const textareaClasses = [
    // Remove default textarea appearance
    'bg-transparent border-none outline-none w-full resize-none',
    // Subtle hover/focus indicator
    'hover:ring-2 hover:ring-gray-900/5 focus:ring-2 focus:ring-gray-900/5 rounded px-1 -mx-1',
    // Placeholder styling
    'placeholder:text-gray-400',
    // Typography based on variant
    variant === 'description'
      ? 'text-sm text-gray-600 italic'
      : 'text-sm text-gray-900',
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
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        maxLength={maxLength}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className={textareaClasses}
      />
      {error && <p id={errorId} className="mt-1 text-sm text-red-500">{error}</p>}
    </div>
  )
}
