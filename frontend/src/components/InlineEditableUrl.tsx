/**
 * Inline editable URL component.
 *
 * Displays URL in a monospace style input that's always editable.
 * Includes a Fetch Metadata button to the left of the URL input.
 *
 * Features:
 * - Monospace styling for URL
 * - Fetch Metadata button with loading/success states
 * - URL validation
 * - Error state with accessible error message
 */
import { useState, forwardRef, useId } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { Tooltip } from './ui'

interface InlineEditableUrlProps {
  /** Current URL value */
  value: string
  /** Called when URL changes */
  onChange: (value: string) => void
  /** Placeholder text shown when empty */
  placeholder?: string
  /** Whether the URL is required */
  required?: boolean
  /** Whether the input is disabled */
  disabled?: boolean
  /** Error message to display */
  error?: string
  /** Called when Enter is pressed */
  onEnter?: () => void
  /** Function to fetch metadata for the URL */
  onFetchMetadata?: () => Promise<void>
  /** Whether metadata is currently being fetched */
  isFetchingMetadata?: boolean
  /** Whether to show fetch success checkmark */
  showFetchSuccess?: boolean
  /** Error message from a failed metadata fetch */
  fetchError?: string
}

/**
 * InlineEditableUrl renders a URL input with monospace styling and fetch metadata button.
 */
export const InlineEditableUrl = forwardRef<HTMLInputElement, InlineEditableUrlProps>(
  function InlineEditableUrl(
    {
      value,
      onChange,
      placeholder = 'https://example.com',
      required = false,
      disabled = false,
      error,
      onEnter,
      onFetchMetadata,
      isFetchingMetadata = false,
      showFetchSuccess = false,
      fetchError,
    },
    ref
  ) {
    const errorId = useId()
    const [isFocused, setIsFocused] = useState(false)

    const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
      onChange(e.target.value)
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter' && onEnter) {
        e.preventDefault()
        onEnter()
      }
    }

    const handleFetchClick = (): void => {
      if (onFetchMetadata && !isFetchingMetadata && !disabled && value.trim()) {
        onFetchMetadata()
      }
    }

    // Build class string based on state
    const inputClasses = [
      // Remove default input appearance
      'bg-transparent border-none outline-none flex-1 min-w-0',
      // Monospace font for URL
      'font-mono text-sm text-gray-700',
      // Placeholder styling
      'placeholder:text-gray-400 placeholder:font-sans',
      // Disabled state
      disabled ? 'cursor-not-allowed opacity-60' : '',
    ]
      .filter(Boolean)
      .join(' ')

    // Container styling for the whole URL row
    const containerClasses = [
      'flex items-center gap-2 w-full',
      // Subtle hover/focus indicator on the container
      'rounded px-1 -mx-1',
      isFocused ? 'ring-2 ring-gray-900/5' : 'hover:ring-2 hover:ring-gray-900/5',
      // Error state
      error ? 'ring-2 ring-red-200' : '',
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div className="w-full">
        <div className={containerClasses}>
          {/* Fetch Metadata button */}
          {onFetchMetadata && (
            <Tooltip
              content={fetchError && !isFetchingMetadata && !showFetchSuccess ? fetchError : 'Fetch metadata from URL'}
              compact={!fetchError || isFetchingMetadata || showFetchSuccess}
            >
              <button
                type="button"
                onClick={handleFetchClick}
                disabled={disabled || isFetchingMetadata || !value.trim()}
                className="shrink-0 p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Fetch metadata from URL"
              >
                {isFetchingMetadata ? (
                  <div className="h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                ) : showFetchSuccess ? (
                  <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : fetchError ? (
                  <svg className="h-4 w-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
              </button>
            </Tooltip>
          )}

          {/* URL input */}
          <input
            ref={ref}
            type="text"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            disabled={disabled}
            required={required}
            aria-required={required}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className={inputClasses}
          />
        </div>
        {error && <p id={errorId} className="mt-1 text-sm text-red-500">{error}</p>}
      </div>
    )
  }
)
