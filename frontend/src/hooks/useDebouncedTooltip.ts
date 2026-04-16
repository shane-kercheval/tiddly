/**
 * Hook for managing a tooltip with delayed show and debounced hide.
 *
 * Designed for cases where multiple trigger elements share one tooltip
 * (e.g., a bookmark title and URL that both show "Open URL in new tab").
 *
 * - First show: delayed by `showDelay` ms
 * - Moving between trigger elements: no re-delay (cancel pending hide, stay visible)
 * - Hide: debounced by `hideDelay` ms to bridge gaps between trigger elements
 */
import { useState, useRef, useCallback, useEffect } from 'react'

interface UseDebouncedTooltipOptions {
  /** Delay before showing the tooltip on first hover (ms). Default: 500 */
  showDelay?: number
  /** Debounce before hiding when leaving a trigger element (ms). Default: 50 */
  hideDelay?: number
}

interface UseDebouncedTooltipReturn {
  /** Whether the tooltip should be visible */
  visible: boolean
  /** Call when mouse enters a trigger element */
  show: () => void
  /** Call when mouse leaves a trigger element */
  hide: () => void
}

export function useDebouncedTooltip({
  showDelay = 500,
  hideDelay = 50,
}: UseDebouncedTooltipOptions = {}): UseDebouncedTooltipReturn {
  const [visible, setVisible] = useState(false)
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current)
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
    }
  }, [])

  const show = useCallback((): void => {
    // If a hide is pending, cancel it — we're re-entering a trigger element
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
      // If already visible, just keep showing (no re-delay)
      if (visible) return
      // Otherwise the tooltip never appeared (show timer was cancelled by hide)
      // — fall through to start a new show timer
    }

    // If already visible, keep it (no re-delay)
    if (visible) return

    // Start show delay (only if not already pending)
    if (!showTimeoutRef.current) {
      showTimeoutRef.current = setTimeout(() => {
        setVisible(true)
        showTimeoutRef.current = null
      }, showDelay)
    }
  }, [visible, showDelay])

  const hide = useCallback((): void => {
    // Cancel any pending show
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current)
      showTimeoutRef.current = null
    }

    // Debounce the hide to allow moving between trigger elements
    hideTimeoutRef.current = setTimeout(() => {
      setVisible(false)
      hideTimeoutRef.current = null
    }, hideDelay)
  }, [hideDelay])

  return { visible, show, hide }
}
