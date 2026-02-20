/**
 * Editor command menu — a floating panel triggered by Cmd+Shift+/.
 *
 * Similar to VS Code's Cmd+Shift+P command palette but scoped to
 * editor formatting, insertion, and app actions (save, discard).
 *
 * Filter text goes into an input, NOT the document, so selections
 * and document content are never affected.
 *
 * This component is conditionally rendered by the parent (mounted when open,
 * unmounted when closed). Each mount starts with fresh state.
 */
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { EditorCommand } from './editorCommands'

interface EditorCommandMenuProps {
  onClose: () => void
  onExecute: (command: EditorCommand) => void
  commands: EditorCommand[]
  /** Pixel coordinates to anchor the menu near. Falls back to centered. */
  anchorCoords: { x: number; y: number } | null
}

/**
 * Group commands by section, preserving insertion order.
 */
function groupBySection(commands: EditorCommand[]): { section: string; items: EditorCommand[] }[] {
  const groups: { section: string; items: EditorCommand[] }[] = []
  let currentSection = ''
  for (const cmd of commands) {
    if (cmd.section !== currentSection) {
      currentSection = cmd.section
      groups.push({ section: currentSection, items: [] })
    }
    groups[groups.length - 1].items.push(cmd)
  }
  return groups
}

export function EditorCommandMenu({
  onClose,
  onExecute,
  commands,
  anchorCoords,
}: EditorCommandMenuProps): ReactNode {
  const [filter, setFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const fadeRef = useRef<HTMLDivElement>(null)

  // Ignore mouse hover until the user actually moves the mouse after mount.
  // Without this, onMouseEnter fires immediately if the cursor happens to be
  // where a menu item appears, hijacking the default selection.
  const mouseMovedRef = useRef(false)
  useEffect(() => {
    const onMove = (): void => {
      mouseMovedRef.current = true
      document.removeEventListener('mousemove', onMove)
    }
    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [])

  // Filter commands by label, clamping selection index inline
  const filtered = filter
    ? commands.filter((cmd) => cmd.label.toLowerCase().includes(filter.toLowerCase()))
    : commands
  const clampedIndex = Math.min(selectedIndex, Math.max(filtered.length - 1, 0))

  // Focus input via ref callback — fires synchronously during React's commit phase,
  // which is the earliest possible moment. This avoids the race condition where
  // requestAnimationFrame-based focus loses to CodeMirror's deferred focus restoration.
  const setInputRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node
    if (node) {
      node.focus()
    }
  }, [])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const items = listRef.current.querySelectorAll('[data-command-item]')
    const el = items[clampedIndex] as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [clampedIndex])

  // Scroll fade — directly set opacity on the DOM element (no React state/re-render).
  const updateFade = useCallback((): void => {
    if (!listRef.current || !fadeRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = listRef.current
    const hasMore = scrollTop + clientHeight < scrollHeight - 4
    fadeRef.current.style.opacity = hasMore ? '1' : '0'
  }, [])

  // Synchronous fade check after every render — runs before the browser paints,
  // so the fade is never visible for a frame when it shouldn't be.
  useLayoutEffect(() => {
    updateFade()
  }, [updateFade, filtered.length])

  // Scroll listener + MutationObserver for ongoing updates
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.addEventListener('scroll', updateFade)
    const observer = new MutationObserver(() => updateFade())
    observer.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener('scroll', updateFade)
      observer.disconnect()
    }
  }, [updateFade])

  // Document-level Escape handler — closes the menu regardless of which element has focus.
  // This is critical because if focus isn't on the input (e.g. CM reclaimed it),
  // the input's onKeyDown handler won't fire, and Escape would propagate to page-level
  // handlers (closing the page instead of the menu).
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape, true)
    return () => document.removeEventListener('keydown', handleEscape, true)
  }, [onClose])

  // Click outside to close
  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Use capture to beat CodeMirror's focus handling
    document.addEventListener('mousedown', handleClick, true)
    return () => document.removeEventListener('mousedown', handleClick, true)
  }, [onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => (i >= filtered.length - 1 ? 0 : i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered[clampedIndex] && !filtered[clampedIndex].disabled) {
          onExecute(filtered[clampedIndex])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    },
    [filtered, clampedIndex, onExecute, onClose]
  )

  // Position the panel near the cursor, or centered if no coords
  const style = computePosition(anchorCoords)

  const groups = groupBySection(filtered)

  return (
    <div
      ref={panelRef}
      className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-lg flex flex-col overflow-hidden"
      style={{ ...style, width: 320, maxHeight: 400 }}
      role="listbox"
      aria-label="Editor commands"
    >
      {/* Filter input */}
      <div className="shrink-0 px-3 py-2 border-b border-gray-100">
        <input
          ref={setInputRef}
          type="text"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setSelectedIndex(0) }}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          className="w-full text-sm bg-transparent outline-none text-gray-900 placeholder-gray-400"
        />
      </div>

      {/* Scrollable command list — direct flex child with overflow-y-auto.
          No nested wrapper needed; flex-1 + min-h-0 constrains to available space,
          overflow-y-auto provides scrolling when items exceed that space. */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto py-1 px-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-gray-400">No matching commands</div>
        ) : (
          groups.map((group, groupIdx) => (
            <div key={group.section}>
              {/* Section divider (skip first section) */}
              {groupIdx > 0 && (
                <div className="mx-2 mt-1 border-t border-gray-200" />
              )}
              {/* Section header */}
              <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wider select-none">
                {group.section}
              </div>
              {group.items.map((cmd) => {
                const flatIndex = filtered.indexOf(cmd)
                const isSelected = flatIndex === clampedIndex
                const isDisabled = cmd.disabled === true
                return (
                  <button
                    key={cmd.id}
                    data-command-item
                    onClick={() => { if (!isDisabled) onExecute(cmd) }}
                    onMouseEnter={() => { if (mouseMovedRef.current) setSelectedIndex(flatIndex) }}
                    style={{ height: 28 }}
                    className={`flex items-center gap-2.5 w-full px-2 text-left text-sm rounded-md transition-colors ${
                      isDisabled
                        ? 'text-gray-300 cursor-default'
                        : isSelected
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={isDisabled}
                  >
                    <span className={`shrink-0 w-[22px] h-[22px] flex items-center justify-center ${isDisabled ? 'text-gray-300' : isSelected ? 'text-blue-500' : 'text-gray-400'}`}>
                      {cmd.icon}
                    </span>
                    <span className="truncate flex-1">{cmd.label}</span>
                    {cmd.shortcut && (
                      <span className="hidden sm:flex items-center gap-0.5 shrink-0 ml-1">
                        {cmd.shortcut.map((key, i) => (
                          <kbd
                            key={i}
                            className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-[3px] text-[10px] font-medium rounded-[3px] border ${
                              isSelected
                                ? 'text-blue-300 bg-blue-100 border-blue-200'
                                : 'text-gray-400 bg-gray-100 border-gray-200'
                            }`}
                          >
                            {key}
                          </kbd>
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>

      {/* Scroll fade overlay — opacity controlled imperatively via ref.
          useLayoutEffect sets it synchronously before paint; scroll/mutation handlers update it. */}
      <div
        ref={fadeRef}
        className="absolute bottom-0 left-1 right-1 pointer-events-none rounded-b-[10px] transition-opacity duration-150"
        style={{
          height: 48,
          background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 70%)',
        }}
      />
    </div>
  )
}

/**
 * Compute CSS position for the menu panel.
 * Anchors directly below the cursor coords, left-aligned with cursor.
 */
function computePosition(
  coords: { x: number; y: number } | null,
): React.CSSProperties {
  if (!coords) {
    // Center horizontally, near top
    return { left: '50%', top: 120, transform: 'translateX(-50%)' }
  }

  const menuWidth = 320
  const menuHeight = 400
  const padding = 8

  // Place directly below cursor, left edge aligned with cursor x
  let left = coords.x
  let top = coords.y + 4

  // Clamp to viewport
  if (left + menuWidth + padding > window.innerWidth) {
    left = window.innerWidth - menuWidth - padding
  }
  if (left < padding) {
    left = padding
  }
  if (top + menuHeight + padding > window.innerHeight) {
    // Place above cursor instead
    top = coords.y - menuHeight - 4
    if (top < padding) {
      top = padding
    }
  }

  return { left, top }
}
