import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedTooltip } from './useDebouncedTooltip'

describe('useDebouncedTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts not visible', () => {
    const { result } = renderHook(() => useDebouncedTooltip())
    expect(result.current.visible).toBe(false)
  })

  it('shows after showDelay', () => {
    const { result } = renderHook(() => useDebouncedTooltip({ showDelay: 500 }))

    act(() => { result.current.show() })
    expect(result.current.visible).toBe(false)

    act(() => { vi.advanceTimersByTime(499) })
    expect(result.current.visible).toBe(false)

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.visible).toBe(true)
  })

  it('hides after hideDelay', () => {
    const { result } = renderHook(() => useDebouncedTooltip({ showDelay: 500, hideDelay: 50 }))

    // Show it first
    act(() => { result.current.show() })
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current.visible).toBe(true)

    // Hide
    act(() => { result.current.hide() })
    expect(result.current.visible).toBe(true) // still visible during debounce

    act(() => { vi.advanceTimersByTime(49) })
    expect(result.current.visible).toBe(true)

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.visible).toBe(false)
  })

  it('cancels show when hide is called before showDelay', () => {
    const { result } = renderHook(() => useDebouncedTooltip({ showDelay: 500 }))

    act(() => { result.current.show() })
    act(() => { vi.advanceTimersByTime(200) })

    act(() => { result.current.hide() })
    act(() => { vi.advanceTimersByTime(500) })

    expect(result.current.visible).toBe(false)
  })

  it('stays visible when re-entering during hide debounce (no re-delay)', () => {
    const { result } = renderHook(() => useDebouncedTooltip({ showDelay: 500, hideDelay: 50 }))

    // Show it
    act(() => { result.current.show() })
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current.visible).toBe(true)

    // Start hiding (mouse leaves)
    act(() => { result.current.hide() })
    act(() => { vi.advanceTimersByTime(30) }) // within debounce window

    // Re-enter before hide fires
    act(() => { result.current.show() })

    // Should stay visible immediately — no 500ms re-delay
    expect(result.current.visible).toBe(true)

    // Should remain visible indefinitely (no pending hide)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.visible).toBe(true)
  })

  it('does not flicker when moving between elements quickly', () => {
    const { result } = renderHook(() => useDebouncedTooltip({ showDelay: 500, hideDelay: 50 }))

    // Show it
    act(() => { result.current.show() })
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current.visible).toBe(true)

    // Simulate fast move: leave element A, enter element B
    act(() => { result.current.hide() })
    act(() => { vi.advanceTimersByTime(10) }) // very fast transition
    act(() => { result.current.show() })

    // Should never have gone invisible
    expect(result.current.visible).toBe(true)
  })

  it('hides when leaving and not re-entering', () => {
    const { result } = renderHook(() => useDebouncedTooltip({ showDelay: 500, hideDelay: 50 }))

    // Show it
    act(() => { result.current.show() })
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current.visible).toBe(true)

    // Leave and don't come back
    act(() => { result.current.hide() })
    act(() => { vi.advanceTimersByTime(50) })
    expect(result.current.visible).toBe(false)
  })

  it('requires full showDelay after a complete hide cycle', () => {
    const { result } = renderHook(() => useDebouncedTooltip({ showDelay: 500, hideDelay: 50 }))

    // Show, then fully hide
    act(() => { result.current.show() })
    act(() => { vi.advanceTimersByTime(500) })
    act(() => { result.current.hide() })
    act(() => { vi.advanceTimersByTime(50) })
    expect(result.current.visible).toBe(false)

    // Re-show requires full delay again
    act(() => { result.current.show() })
    expect(result.current.visible).toBe(false)

    act(() => { vi.advanceTimersByTime(499) })
    expect(result.current.visible).toBe(false)

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.visible).toBe(true)
  })

  it('re-entering during hide debounce restarts show when tooltip never appeared', () => {
    const { result } = renderHook(() => useDebouncedTooltip({ showDelay: 500, hideDelay: 50 }))

    // Enter link area — starts 500ms show timer
    act(() => { result.current.show() })
    act(() => { vi.advanceTimersByTime(200) }) // 200ms into show delay

    // Leave before tooltip appears — cancels show, starts 50ms hide timer
    act(() => { result.current.hide() })
    expect(result.current.visible).toBe(false)

    // Re-enter within hide debounce window
    act(() => { vi.advanceTimersByTime(20) })
    act(() => { result.current.show() })

    // Should NOT be visible yet (needs new show delay)
    expect(result.current.visible).toBe(false)

    // But should become visible after a new 500ms delay
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current.visible).toBe(true)
  })

  it('does not start duplicate show timers on repeated show calls', () => {
    const { result } = renderHook(() => useDebouncedTooltip({ showDelay: 500 }))

    act(() => { result.current.show() })
    act(() => { vi.advanceTimersByTime(200) })
    act(() => { result.current.show() }) // duplicate call

    // Should show at 500ms from first call, not 700ms
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current.visible).toBe(true)
  })

  it('stays visible on repeated show calls when already visible', () => {
    const { result } = renderHook(() => useDebouncedTooltip({ showDelay: 500 }))

    act(() => { result.current.show() })
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current.visible).toBe(true)

    // Repeated show calls should be no-ops
    act(() => { result.current.show() })
    expect(result.current.visible).toBe(true)
  })
})
