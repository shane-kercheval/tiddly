/**
 * Presentational component for progressive character limit feedback.
 *
 * Renders a feedback row with message on left and count on right.
 * Uses visibility:hidden to reserve space and prevent layout shift.
 */
import type { ReactNode } from 'react'
import type { CharacterLimitResult } from '../hooks/useCharacterLimit'

interface CharacterLimitFeedbackProps {
  /** Result from useCharacterLimit hook */
  limit: CharacterLimitResult
  /** Additional CSS classes for the container */
  className?: string
}

export function CharacterLimitFeedback({ limit, className = '' }: CharacterLimitFeedbackProps): ReactNode {
  return (
    <div
      className={`flex justify-between items-center text-xs h-4 ${className}`}
      style={{
        visibility: limit.showCounter ? 'visible' : 'hidden',
        color: limit.color,
      }}
      data-testid="character-limit-feedback"
    >
      <span>{limit.message ?? ''}</span>
      <span>{limit.counterText}</span>
    </div>
  )
}
