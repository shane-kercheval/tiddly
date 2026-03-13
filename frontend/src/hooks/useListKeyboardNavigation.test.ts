/**
 * Tests for useListKeyboardNavigation hook.
 *
 * Tests keyboard navigation behavior (ArrowUp/Down/Enter), selection model,
 * mouse interaction gating, scrollIntoView, ARIA prop-getters, and edge cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { KeyboardEvent } from 'react'
import { useListKeyboardNavigation } from './useListKeyboardNavigation'

// Helper to create a fake KeyboardEvent for React
function keyEvent(key: string, target?: HTMLElement): KeyboardEvent {
  return {
    key,
    preventDefault: vi.fn(),
    target: target ?? document.createElement('div'),
    currentTarget: target ?? document.createElement('div'),
  } as unknown as KeyboardEvent
}

// Helper to create an event from a nested interactive element
function nestedKeyEvent(key: string, tagName: string): KeyboardEvent {
  const nested = document.createElement(tagName)
  const container = document.createElement('div')
  return {
    key,
    preventDefault: vi.fn(),
    target: nested,
    currentTarget: container,
  } as unknown as KeyboardEvent
}

describe('useListKeyboardNavigation', () => {
  const mockOnSelect = vi.fn()
  const mockOnExitTop = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderNav(overrides: Partial<Parameters<typeof useListKeyboardNavigation>[0]> = {}) {
    return renderHook(
      (props) => useListKeyboardNavigation(props),
      {
        initialProps: {
          itemCount: 5,
          onSelect: mockOnSelect,
          onExitTop: mockOnExitTop,
          ...overrides,
        },
      },
    )
  }

  // --- Selection model ---

  it('starts with selectedIndex at -1 by default', () => {
    const { result } = renderNav()
    expect(result.current.selectedIndex).toBe(-1)
  })

  it('starts at initialIndex when provided', () => {
    const { result } = renderNav({ initialIndex: 0 })
    expect(result.current.selectedIndex).toBe(0)
  })

  it('ArrowDown from -1 transitions to 0', () => {
    const { result } = renderNav()
    act(() => {
      result.current.getInputProps().onKeyDown(keyEvent('ArrowDown'))
    })
    expect(result.current.selectedIndex).toBe(0)
  })

  it('ArrowDown increments selectedIndex', () => {
    const { result } = renderNav({ initialIndex: 0 })
    act(() => {
      result.current.getInputProps().onKeyDown(keyEvent('ArrowDown'))
    })
    expect(result.current.selectedIndex).toBe(1)
  })

  it('ArrowDown clamps at itemCount - 1', () => {
    const { result } = renderNav({ initialIndex: 4, itemCount: 5 })
    act(() => {
      result.current.getInputProps().onKeyDown(keyEvent('ArrowDown'))
    })
    expect(result.current.selectedIndex).toBe(4)
  })

  it('ArrowUp decrements selectedIndex', () => {
    const { result } = renderNav({ initialIndex: 2 })
    act(() => {
      result.current.getInputProps().onKeyDown(keyEvent('ArrowUp'))
    })
    expect(result.current.selectedIndex).toBe(1)
  })

  it('ArrowUp from -1 is a no-op', () => {
    const { result } = renderNav()
    act(() => {
      result.current.getInputProps().onKeyDown(keyEvent('ArrowUp'))
    })
    expect(result.current.selectedIndex).toBe(-1)
    expect(mockOnExitTop).not.toHaveBeenCalled()
  })

  it('ArrowUp at index 0 calls onExitTop and resets to -1', () => {
    const { result } = renderNav({ initialIndex: 0 })
    act(() => {
      result.current.getInputProps().onKeyDown(keyEvent('ArrowUp'))
    })
    expect(mockOnExitTop).toHaveBeenCalledOnce()
    expect(result.current.selectedIndex).toBe(-1)
  })

  it('onExitTop resets mouseMoved so hover does not re-select', () => {
    const { result } = renderNav({ initialIndex: 0 })

    // Simulate mouse movement then hover on item 2
    act(() => { result.current.getListProps().onMouseMove() })
    act(() => { result.current.getItemProps(2).onMouseEnter() })
    expect(result.current.selectedIndex).toBe(2)

    // Navigate back up to 0 via keyboard
    act(() => { result.current.getInputProps().onKeyDown(keyEvent('ArrowUp')) })
    act(() => { result.current.getInputProps().onKeyDown(keyEvent('ArrowUp')) })
    expect(result.current.selectedIndex).toBe(0)

    // Exit top — should reset mouseMoved
    act(() => { result.current.getInputProps().onKeyDown(keyEvent('ArrowUp')) })
    expect(result.current.selectedIndex).toBe(-1)

    // Mouse enter should be ignored since mouseMoved was reset
    act(() => { result.current.getItemProps(2).onMouseEnter() })
    expect(result.current.selectedIndex).toBe(-1)
  })

  it('ArrowUp at index 0 stays at 0 when onExitTop is not provided', () => {
    const { result } = renderNav({ initialIndex: 0, onExitTop: undefined })
    act(() => {
      result.current.getInputProps().onKeyDown(keyEvent('ArrowUp'))
    })
    expect(result.current.selectedIndex).toBe(0)
  })

  // --- Enter ---

  it('Enter calls onSelect with current index', () => {
    const { result } = renderNav({ initialIndex: 2 })
    act(() => {
      result.current.getInputProps().onKeyDown(keyEvent('Enter'))
    })
    expect(mockOnSelect).toHaveBeenCalledWith(2)
  })

  it('Enter is a no-op when selectedIndex is -1 and does not preventDefault', () => {
    const { result } = renderNav()
    const event = keyEvent('Enter')
    act(() => {
      result.current.getInputProps().onKeyDown(event)
    })
    expect(mockOnSelect).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  // --- Reset ---

  it('resetSelection resets to initialIndex and mouseMoved to false', () => {
    const { result } = renderNav({ initialIndex: 0 })
    // Navigate to index 2
    act(() => {
      result.current.getInputProps().onKeyDown(keyEvent('ArrowDown'))
      result.current.getInputProps().onKeyDown(keyEvent('ArrowDown'))
    })
    expect(result.current.selectedIndex).toBe(2)

    act(() => {
      result.current.resetSelection()
    })
    expect(result.current.selectedIndex).toBe(0)
    expect(result.current.mouseMoved).toBe(false)
  })

  it('resetSelection defaults to -1 when no initialIndex', () => {
    const { result } = renderNav()
    act(() => {
      result.current.getInputProps().onKeyDown(keyEvent('ArrowDown'))
    })
    expect(result.current.selectedIndex).toBe(0)

    act(() => {
      result.current.resetSelection()
    })
    expect(result.current.selectedIndex).toBe(-1)
  })

  it('resetSelection uses resetIndex when provided instead of initialIndex', () => {
    const { result } = renderNav({ initialIndex: 3, resetIndex: -1 })
    // Initial state uses initialIndex
    expect(result.current.selectedIndex).toBe(3)

    act(() => {
      result.current.resetSelection()
    })
    // Reset uses resetIndex, not initialIndex
    expect(result.current.selectedIndex).toBe(-1)
  })

  // --- Clamping on itemCount change ---

  it('clamps when itemCount shrinks below current index', () => {
    const { result, rerender } = renderNav({ initialIndex: 4, itemCount: 5 })
    expect(result.current.selectedIndex).toBe(4)

    rerender({ itemCount: 2, onSelect: mockOnSelect, onExitTop: mockOnExitTop, initialIndex: 4 })
    expect(result.current.selectedIndex).toBe(1)
  })

  it('items going from N → 0 → N clamps correctly', () => {
    const { result, rerender } = renderNav({ initialIndex: 2, itemCount: 5 })
    expect(result.current.selectedIndex).toBe(2)

    // Shrink to 0
    rerender({ itemCount: 0, onSelect: mockOnSelect, onExitTop: mockOnExitTop, initialIndex: 2 })
    expect(result.current.selectedIndex).toBe(-1)

    // Grow back to 5
    rerender({ itemCount: 5, onSelect: mockOnSelect, onExitTop: mockOnExitTop, initialIndex: 2 })
    // After going to -1, stays at -1 (doesn't auto-restore)
    expect(result.current.selectedIndex).toBe(-1)
  })

  // --- Mouse interaction ---

  it('mouseMoved starts false, becomes true on mouse move', () => {
    const { result } = renderNav()
    expect(result.current.mouseMoved).toBe(false)

    // Before mouse move, mouseEnter on item should not update selection
    act(() => {
      result.current.getItemProps(2).onMouseEnter()
    })
    expect(result.current.selectedIndex).toBe(-1)

    // Trigger mouse move
    act(() => {
      result.current.getListProps().onMouseMove()
    })
    expect(result.current.mouseMoved).toBe(true)

    // Now mouseEnter should work
    act(() => {
      result.current.getItemProps(2).onMouseEnter()
    })
    expect(result.current.selectedIndex).toBe(2)
  })

  // --- scrollIntoView ---

  it('scrollIntoView is called when selectedIndex changes', () => {
    // Set up a real DOM container with items
    const container = document.createElement('div')
    const item0 = document.createElement('div')
    item0.setAttribute('data-nav-item', 'true')
    const item1 = document.createElement('div')
    item1.setAttribute('data-nav-item', 'true')
    container.appendChild(item0)
    container.appendChild(item1)

    const { result } = renderNav({ initialIndex: -1 })

    // Attach the ref
    result.current.listRef.current = container

    act(() => {
      result.current.getInputProps().onKeyDown(keyEvent('ArrowDown'))
    })

    expect(item0.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('scrollIntoView is not called for -1', () => {
    const container = document.createElement('div')
    const item = document.createElement('div')
    item.setAttribute('data-nav-item', 'true')
    container.appendChild(item)

    const { result } = renderNav({ initialIndex: -1 })
    result.current.listRef.current = container

    // scrollIntoView should not have been called on the item since index is -1
    expect(item.scrollIntoView).not.toHaveBeenCalled()
  })

  // --- preventDefault ---

  it('Arrow keys are preventDefault-ed', () => {
    const { result } = renderNav({ initialIndex: 0 })
    const downEvent = keyEvent('ArrowDown')
    const upEvent = keyEvent('ArrowUp')

    act(() => {
      result.current.getInputProps().onKeyDown(downEvent)
    })
    expect(downEvent.preventDefault).toHaveBeenCalled()

    act(() => {
      result.current.getInputProps().onKeyDown(upEvent)
    })
    expect(upEvent.preventDefault).toHaveBeenCalled()
  })

  it('Enter preventDefault-ed only when an item is selected', () => {
    const { result } = renderNav({ initialIndex: 0 })
    const enterEvent = keyEvent('Enter')

    act(() => {
      result.current.getInputProps().onKeyDown(enterEvent)
    })
    expect(enterEvent.preventDefault).toHaveBeenCalled()
  })

  // --- Enabled ---

  it('does nothing when enabled is false', () => {
    const { result } = renderNav({ enabled: false, initialIndex: 0 })
    act(() => {
      result.current.getInputProps().onKeyDown(keyEvent('ArrowDown'))
    })
    expect(result.current.selectedIndex).toBe(0)
  })

  // --- Nested interactive elements ---

  it('ignores key events from nested buttons', () => {
    const { result } = renderNav({ initialIndex: 0 })
    act(() => {
      result.current.getListProps().onKeyDown(nestedKeyEvent('ArrowDown', 'button'))
    })
    expect(result.current.selectedIndex).toBe(0)
  })

  it('ignores key events from nested links', () => {
    const { result } = renderNav({ initialIndex: 0 })
    act(() => {
      result.current.getListProps().onKeyDown(nestedKeyEvent('ArrowDown', 'a'))
    })
    expect(result.current.selectedIndex).toBe(0)
  })

  it('ignores key events from nested selects', () => {
    const { result } = renderNav({ initialIndex: 0 })
    act(() => {
      result.current.getListProps().onKeyDown(nestedKeyEvent('ArrowDown', 'select'))
    })
    expect(result.current.selectedIndex).toBe(0)
  })

  // --- ARIA prop-getters ---

  it('getInputProps returns aria-activedescendant matching selected item id', () => {
    const { result } = renderNav({ initialIndex: 2 })
    const inputProps = result.current.getInputProps()
    expect(inputProps['aria-activedescendant']).toBe('nav-item-2')
  })

  it('getInputProps omits aria-activedescendant when selectedIndex is -1', () => {
    const { result } = renderNav()
    const inputProps = result.current.getInputProps()
    expect(inputProps).not.toHaveProperty('aria-activedescendant')
  })

  it('getItemProps returns aria-selected true only for selected index', () => {
    const { result } = renderNav({ initialIndex: 1 })
    expect(result.current.getItemProps(0)['aria-selected']).toBe(false)
    expect(result.current.getItemProps(1)['aria-selected']).toBe(true)
    expect(result.current.getItemProps(2)['aria-selected']).toBe(false)
  })

  it('getItemProps returns correct id and data-nav-item', () => {
    const { result } = renderNav()
    const props = result.current.getItemProps(3)
    expect(props.id).toBe('nav-item-3')
    expect(props['data-nav-item']).toBe(true)
    expect(props.role).toBe('option')
  })

  it('getListProps returns role="listbox"', () => {
    const { result } = renderNav()
    const listProps = result.current.getListProps()
    expect(listProps.role).toBe('listbox')
  })

  // --- ID prefix ---

  it('uses custom idPrefix in item ids and aria-activedescendant', () => {
    const { result } = renderNav({ idPrefix: 'cmd', initialIndex: 1 })
    expect(result.current.getItemProps(0).id).toBe('cmd-0')
    expect(result.current.getItemProps(1).id).toBe('cmd-1')
    expect(result.current.getInputProps()['aria-activedescendant']).toBe('cmd-1')
  })

  // --- listRef exposed ---

  it('exposes listRef for imperative access', () => {
    const { result } = renderNav()
    expect(result.current.listRef).toBeDefined()
    expect(result.current.listRef.current).toBeNull()
  })
})
