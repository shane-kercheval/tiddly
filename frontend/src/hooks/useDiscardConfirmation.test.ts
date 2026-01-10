import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiscardConfirmation } from './useDiscardConfirmation'

describe('useDiscardConfirmation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('should call onDiscard immediately when not dirty', () => {
    const onDiscard = vi.fn()
    const { result } = renderHook(() =>
      useDiscardConfirmation({
        isDirty: false,
        onDiscard,
      })
    )

    act(() => {
      result.current.requestDiscard()
    })

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(result.current.isConfirming).toBe(false)
  })

  it('should set isConfirming to true on first requestDiscard when dirty', () => {
    const onDiscard = vi.fn()
    const { result } = renderHook(() =>
      useDiscardConfirmation({
        isDirty: true,
        onDiscard,
      })
    )

    act(() => {
      result.current.requestDiscard()
    })

    expect(result.current.isConfirming).toBe(true)
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('should call onConfirmLeave then onDiscard on second requestDiscard when dirty', () => {
    const onDiscard = vi.fn()
    const onConfirmLeave = vi.fn()
    const { result } = renderHook(() =>
      useDiscardConfirmation({
        isDirty: true,
        onDiscard,
        onConfirmLeave,
      })
    )

    // First call - sets confirming
    act(() => {
      result.current.requestDiscard()
    })
    expect(result.current.isConfirming).toBe(true)
    expect(onDiscard).not.toHaveBeenCalled()

    // Second call - executes discard
    act(() => {
      result.current.requestDiscard()
    })
    expect(onConfirmLeave).toHaveBeenCalledTimes(1)
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('should reset isConfirming after timeout', () => {
    const onDiscard = vi.fn()
    const { result } = renderHook(() =>
      useDiscardConfirmation({
        isDirty: true,
        onDiscard,
        timeout: 3000,
      })
    )

    act(() => {
      result.current.requestDiscard()
    })
    expect(result.current.isConfirming).toBe(true)

    // Advance time by 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(result.current.isConfirming).toBe(false)
  })

  it('should use custom timeout', () => {
    const onDiscard = vi.fn()
    const { result } = renderHook(() =>
      useDiscardConfirmation({
        isDirty: true,
        onDiscard,
        timeout: 5000,
      })
    )

    act(() => {
      result.current.requestDiscard()
    })
    expect(result.current.isConfirming).toBe(true)

    // Not reset after 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.isConfirming).toBe(true)

    // Reset after 5 seconds
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.isConfirming).toBe(false)
  })

  it('should reset confirmation state with resetConfirmation', () => {
    const onDiscard = vi.fn()
    const { result } = renderHook(() =>
      useDiscardConfirmation({
        isDirty: true,
        onDiscard,
      })
    )

    act(() => {
      result.current.requestDiscard()
    })
    expect(result.current.isConfirming).toBe(true)

    act(() => {
      result.current.resetConfirmation()
    })
    expect(result.current.isConfirming).toBe(false)
  })

  it('should clear timeout when resetConfirmation is called', () => {
    const onDiscard = vi.fn()
    const { result } = renderHook(() =>
      useDiscardConfirmation({
        isDirty: true,
        onDiscard,
        timeout: 3000,
      })
    )

    act(() => {
      result.current.requestDiscard()
    })

    act(() => {
      result.current.resetConfirmation()
    })

    // Advance time - should not re-trigger anything
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.isConfirming).toBe(false)
  })

  it('should clear timeout on unmount', () => {
    const onDiscard = vi.fn()
    const { result, unmount } = renderHook(() =>
      useDiscardConfirmation({
        isDirty: true,
        onDiscard,
      })
    )

    act(() => {
      result.current.requestDiscard()
    })

    // Unmount before timeout
    unmount()

    // Should not throw or cause issues
    act(() => {
      vi.advanceTimersByTime(5000)
    })
  })

  it('should work without onConfirmLeave', () => {
    const onDiscard = vi.fn()
    const { result } = renderHook(() =>
      useDiscardConfirmation({
        isDirty: true,
        onDiscard,
      })
    )

    // First call
    act(() => {
      result.current.requestDiscard()
    })

    // Second call - should still work
    act(() => {
      result.current.requestDiscard()
    })

    expect(onDiscard).toHaveBeenCalledTimes(1)
  })
})
