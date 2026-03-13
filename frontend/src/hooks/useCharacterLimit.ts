/**
 * Hook for progressive character limit feedback.
 *
 * Computes visual feedback state (color, message, counter text) based on
 * current length vs max length. Does NOT handle save-disable logic — that
 * stays in parent entity forms' isValid memos.
 */
import { useMemo } from 'react'
import { getLimitColor } from '../utils/limitFeedbackColor'

export interface CharacterLimitOptions {
  /** When true, counter is always visible and color stays gray below 85% (for content fields) */
  alwaysShow?: boolean
}

export interface CharacterLimitResult {
  /** Whether the field has exceeded its limit (> maxLength) */
  exceeded: boolean
  /** Whether the counter should be visible */
  showCounter: boolean
  /** Formatted count string, e.g. "1,234 / 2,048" */
  counterText: string
  /** Message to show on the left, or undefined if no message */
  message: string | undefined
  /** CSS color string for the feedback text */
  color: string
}

const EMPTY_RESULT: CharacterLimitResult = {
  exceeded: false,
  showCounter: false,
  counterText: '',
  message: undefined,
  color: '',
}

export function useCharacterLimit(
  length: number,
  maxLength: number | undefined,
  options?: CharacterLimitOptions,
): CharacterLimitResult {
  const alwaysShow = options?.alwaysShow ?? false

  return useMemo(() => {
    if (maxLength === undefined) return EMPTY_RESULT

    const ratio = length / maxLength
    const counterText = `${length.toLocaleString()} / ${maxLength.toLocaleString()}`
    const isDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false

    if (!alwaysShow && ratio < 0.7) {
      return EMPTY_RESULT
    }

    const color = getLimitColor(ratio, isDark, alwaysShow)

    if (ratio > 1) {
      return {
        exceeded: true,
        showCounter: true,
        counterText,
        message: 'Character limit exceeded - saving is disabled',
        color,
      }
    }

    if (ratio >= 1) {
      return {
        exceeded: false,
        showCounter: true,
        counterText,
        message: 'Character limit reached',
        color,
      }
    }

    return {
      exceeded: false,
      showCounter: true,
      counterText,
      message: undefined,
      color,
    }
  }, [length, maxLength, alwaysShow])
}
