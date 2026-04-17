/**
 * Shared hook for keyboard navigation of item lists.
 *
 * Provides arrow key navigation (ArrowUp/Down), Enter selection, scroll-into-view,
 * mouse-movement gating (ghost-highlight prevention), and ARIA attributes via
 * prop-getter functions.
 *
 * Focus stays on the search input during navigation (VS Code-style).
 * The hook returns prop-getters that bundle event handlers and ARIA attributes
 * for the input, list container, and individual items.
 *
 * Used by CommandPalette (commands + search views) and AllContent page.
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import type { KeyboardEvent, RefObject } from 'react'

export interface UseListKeyboardNavigationOptions {
  /** Total number of navigable items */
  itemCount: number
  /** Called when Enter is pressed on the selected item */
  onSelect: (index: number) => void
  /** Called when ArrowUp is pressed while on the first item (e.g., refocus search input) */
  onExitTop?: () => void
  /** CSS selector for navigable items within the container (default: '[data-nav-item]') */
  itemSelector?: string
  /** Whether navigation is currently active */
  enabled?: boolean
  /** Initial selected index (-1 = no selection, 0+ = preselect). Default: -1 */
  initialIndex?: number
  /** Index to reset to when resetSelection is called. Defaults to initialIndex. Useful when initial selection should differ from the reset target (e.g., restore-once). */
  resetIndex?: number
  /** Prefix for item IDs and aria-activedescendant (default: 'nav-item'). Use to avoid collisions when multiple instances coexist. */
  idPrefix?: string
}

export interface InputProps {
  onKeyDown: (e: KeyboardEvent) => void
  'aria-activedescendant'?: string
}

export interface ListProps {
  ref: RefObject<HTMLDivElement | null>
  onKeyDown: (e: KeyboardEvent) => void
  onMouseMove: () => void
  role: 'listbox'
}

export interface ItemProps {
  id: string
  'data-nav-item': true
  'aria-selected': boolean
  role: 'option'
  onMouseEnter: () => void
}

export interface UseListKeyboardNavigationReturn {
  /** Currently selected index (-1 = no selection, 0+ = valid item) */
  selectedIndex: number
  /** Whether the user has moved the mouse since last reset (for ghost-highlight prevention) */
  mouseMoved: boolean
  /** Ref to the list container element (for imperative operations like Tab-to-focus) */
  listRef: RefObject<HTMLDivElement | null>
  /** Reset selection to resetIndex (or initialIndex if resetIndex not set) and mouseMoved to false */
  resetSelection: () => void
  /** Props to spread on the search input */
  getInputProps: () => InputProps
  /** Props to spread on the list container */
  getListProps: () => ListProps
  /** Props to spread on each navigable item */
  getItemProps: (index: number) => ItemProps
}

/** Interactive elements whose key events the hook should ignore */
const INTERACTIVE_SELECTOR = 'button, a, select, input, textarea'

export function useListKeyboardNavigation({
  itemCount,
  onSelect,
  onExitTop,
  itemSelector = '[data-nav-item]',
  enabled = true,
  initialIndex = -1,
  resetIndex,
  idPrefix = 'nav-item',
}: UseListKeyboardNavigationOptions): UseListKeyboardNavigationReturn {
  const effectiveResetIndex = resetIndex ?? initialIndex
  const [selectedIndex, setSelectedIndex] = useState(initialIndex)
  const [mouseMoved, setMouseMoved] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Clamp selectedIndex when itemCount shrinks
  const clampedIndex = itemCount === 0
    ? -1
    : selectedIndex === -1
      ? -1
      : Math.min(selectedIndex, itemCount - 1)

  // Sync clamped value back to state when it diverges.
  // This is React's "adjusting state when props change" pattern — ensures
  // functional updaters in ArrowUp/Down read the clamped value, not stale state.
  if (clampedIndex !== selectedIndex) {
    setSelectedIndex(clampedIndex)
  }

  // Scroll selected item into view
  useEffect(() => {
    if (clampedIndex < 0) return
    const list = listRef.current
    if (!list) return
    const items = list.querySelectorAll(itemSelector)
    items[clampedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [clampedIndex, itemSelector])

  const resetSelection = useCallback(() => {
    setSelectedIndex(effectiveResetIndex)
    setMouseMoved(false)
  }, [effectiveResetIndex])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return

      // Ignore events from nested interactive elements (buttons, links, etc.)
      // unless it's the bound input itself
      const target = e.target as HTMLElement
      if (target.matches(INTERACTIVE_SELECTOR) && target !== e.currentTarget) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        // Enter keyboard-nav mode: suppress hover/actions via data-mouse-moved
        setMouseMoved(false)
        setSelectedIndex((i) => {
          if (i === -1) return 0
          return Math.min(i + 1, itemCount - 1)
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        // Enter keyboard-nav mode: suppress hover/actions via data-mouse-moved
        setMouseMoved(false)
        if (clampedIndex === -1) return
        if (clampedIndex === 0) {
          if (onExitTop) {
            onExitTop()
            setSelectedIndex(-1)
          }
          return
        }
        setSelectedIndex((i) => i - 1)
      } else if (e.key === 'Enter' && clampedIndex >= 0) {
        e.preventDefault()
        onSelect(clampedIndex)
      }
    },
    [enabled, itemCount, clampedIndex, onSelect, onExitTop],
  )

  const handleMouseMove = useCallback(() => {
    if (!mouseMoved) setMouseMoved(true)
  }, [mouseMoved])

  const handleMouseEnter = useCallback(
    (index: number) => {
      if (mouseMoved) setSelectedIndex(index)
    },
    [mouseMoved],
  )

  const getInputProps = useMemo(
    () => (): InputProps => {
      const props: InputProps = {
        onKeyDown: handleKeyDown,
      }
      if (clampedIndex >= 0) {
        props['aria-activedescendant'] = `${idPrefix}-${clampedIndex}`
      }
      return props
    },
    [handleKeyDown, clampedIndex, idPrefix],
  )

  const getListProps = useMemo(
    () => (): ListProps => ({
      ref: listRef,
      onKeyDown: handleKeyDown,
      onMouseMove: handleMouseMove,
      role: 'listbox',
    }),
    [handleKeyDown, handleMouseMove],
  )

  const getItemProps = useCallback(
    (index: number): ItemProps => ({
      id: `${idPrefix}-${index}`,
      'data-nav-item': true,
      'aria-selected': index === clampedIndex,
      role: 'option',
      onMouseEnter: () => handleMouseEnter(index),
    }),
    [clampedIndex, handleMouseEnter, idPrefix],
  )

  return {
    selectedIndex: clampedIndex,
    mouseMoved,
    listRef,
    resetSelection,
    getInputProps,
    getListProps,
    getItemProps,
  }
}
