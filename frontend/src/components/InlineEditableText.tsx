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
 * - Optional character limit with progressive counter
 * - Error state with accessible error message
 * - Optional sparkle icon for AI metadata suggestions
 */
import { useEffect, useRef, useId } from 'react'
import type { ReactNode, ChangeEvent } from 'react'
import { useCharacterLimit } from '../hooks/useCharacterLimit'
import { CharacterLimitFeedback } from './CharacterLimitFeedback'
import { SparklesIcon } from './icons'
import { Tooltip } from './ui'

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
  /** Called when the sparkle icon is clicked. Omit to hide the icon. */
  onSuggest?: () => void
  /** Whether a suggestion request is in flight. */
  isSuggesting?: boolean
  /** Whether the suggest icon should be disabled (insufficient context). */
  suggestDisabled?: boolean
  /** Tooltip text for the disabled suggest icon. */
  suggestTooltip?: string
}

/**
 * InlineEditableText renders as styled text that's directly editable.
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
  onSuggest,
  isSuggesting = false,
  suggestDisabled = false,
  suggestTooltip,
}: InlineEditableTextProps): ReactNode {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const errorId = useId()
  const limit = useCharacterLimit(value.length, maxLength)

  // Auto-resize textarea to fit content
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea && multiline) {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [value, multiline])

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange(e.target.value)
  }

  // When a suggest icon is present, ring styling moves to the group wrapper
  // so hovering over the icon keeps the border visible (focus-within for keyboard).
  const hasRingOnWrapper = !!onSuggest && !disabled
  const textareaClasses = [
    'bg-transparent border-none outline-none w-full resize-none',
    (error || limit.exceeded)
      ? 'rounded px-1 -mx-1' + (hasRingOnWrapper ? '' : ' ring-2 ring-red-200 hover:ring-red-200 focus:ring-red-200')
      : hasRingOnWrapper
        ? 'rounded px-1 -mx-1'
        : 'hover:ring-2 hover:ring-gray-900/5 focus:ring-2 focus:ring-gray-900/5 rounded px-1 -mx-1',
    'placeholder:text-gray-400',
    variant === 'description'
      ? 'text-sm text-gray-600 italic'
      : 'text-sm text-gray-900',
    disabled ? 'cursor-not-allowed opacity-60' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const showSuggestIcon = onSuggest && !disabled

  return (
    <div className="w-full">
      <div className={`group/suggest flex items-start ${hasRingOnWrapper ? (error || limit.exceeded ? 'ring-2 ring-red-200 rounded px-1 -mx-1' : 'hover:ring-2 hover:ring-gray-900/5 focus-within:ring-2 focus-within:ring-gray-900/5 rounded px-1 -mx-1') : ''}`}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className={textareaClasses}
        />
        {showSuggestIcon && (
          <Tooltip
            content={suggestDisabled && suggestTooltip ? suggestTooltip : 'Suggest description'}
            compact
            delay={500}
            position="left"
          >
            <button
              type="button"
              onClick={onSuggest}
              disabled={suggestDisabled || isSuggesting}
              aria-busy={isSuggesting}
              className="btn-ai-icon shrink-0 mt-px p-0.5 rounded opacity-0 group-hover/suggest:opacity-100 focus-visible:opacity-100 disabled:opacity-0 disabled:group-hover/suggest:opacity-40 disabled:focus-visible:opacity-40 disabled:cursor-not-allowed"
              aria-label="Suggest description"
            >
              {isSuggesting ? (
                <div className="spinner-ai h-4 w-4" />
              ) : (
                <SparklesIcon className="h-4 w-4" />
              )}
            </button>
          </Tooltip>
        )}
      </div>
      {error && <p id={errorId} className="mt-1 text-sm text-red-500">{error}</p>}
      {maxLength !== undefined && <CharacterLimitFeedback limit={limit} />}
    </div>
  )
}
