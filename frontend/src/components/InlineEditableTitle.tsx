/**
 * Inline editable title component.
 *
 * Displays as styled text but is actually an input that can be edited.
 * Used for note titles, prompt names, etc. where the field should look
 * like view-mode text but be directly editable.
 *
 * Optionally shows a sparkle icon for AI metadata suggestions.
 */
import { useId, forwardRef } from 'react'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { useCharacterLimit } from '../hooks/useCharacterLimit'
import { CharacterLimitFeedback } from './CharacterLimitFeedback'
import { SparklesIcon } from './icons'
import { Tooltip } from './ui'

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
  /** Maximum character length */
  maxLength?: number
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
 * InlineEditableTitle renders as styled text that's directly editable.
 */
export const InlineEditableTitle = forwardRef<HTMLInputElement, InlineEditableTitleProps>(
  function InlineEditableTitle(
    {
      value,
      onChange,
      placeholder = 'Title',
      required = false,
      disabled = false,
      variant = 'title',
      className = '',
      onEnter,
      error,
      maxLength,
      onSuggest,
      isSuggesting = false,
      suggestDisabled = false,
      suggestTooltip,
    },
    ref
  ): ReactNode {
    const errorId = useId()
    const limit = useCharacterLimit(value.length, maxLength)

    const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
      onChange(e.target.value)
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter' && onEnter) {
        e.preventDefault()
        onEnter()
      }
    }

    const hasRingOnWrapper = !!onSuggest && !disabled
    const inputClasses = [
      'bg-transparent border-none outline-none w-full',
      (error || limit.exceeded)
        ? 'rounded px-1 -mx-1' + (hasRingOnWrapper ? '' : ' ring-2 ring-red-200 hover:ring-red-200 focus:ring-red-200')
        : hasRingOnWrapper
          ? 'rounded px-1 -mx-1'
          : 'hover:ring-2 hover:ring-gray-900/5 focus:ring-2 focus:ring-gray-900/5 rounded px-1 -mx-1',
      'placeholder:text-gray-400',
      variant === 'name'
        ? 'font-mono text-lg text-gray-900'
        : 'text-2xl font-bold text-gray-900',
      disabled ? 'cursor-not-allowed opacity-60' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    const showSuggestIcon = onSuggest && !disabled

    return (
      <div className="w-full">
        <div className={`group/suggest flex items-center ${hasRingOnWrapper ? (error || limit.exceeded ? 'ring-2 ring-red-200 rounded px-1 -mx-1' : 'hover:ring-2 hover:ring-gray-900/5 focus-within:ring-2 focus-within:ring-gray-900/5 rounded px-1 -mx-1') : ''}`}>
          <input
            ref={ref}
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
          {showSuggestIcon && (
            <Tooltip
              content={suggestDisabled && suggestTooltip ? suggestTooltip : 'Suggest title'}
              compact
              delay={500}
              position="left"
            >
              <button
                type="button"
                onClick={onSuggest}
                disabled={suggestDisabled || isSuggesting}
                aria-busy={isSuggesting}
                className="btn-ai-icon shrink-0 p-0.5 rounded opacity-0 group-hover/suggest:opacity-100 focus-visible:opacity-100 disabled:opacity-0 disabled:group-hover/suggest:opacity-40 disabled:focus-visible:opacity-40 disabled:cursor-not-allowed"
                aria-label="Suggest title"
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
)
