import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useStaleCheck } from './useStaleCheck'

describe('useStaleCheck', () => {
  // Mock document.visibilityState
  let originalVisibilityState: PropertyDescriptor | undefined

  beforeEach(() => {
    originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })

  afterEach(() => {
    if (originalVisibilityState) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityState)
    }
    vi.clearAllMocks()
  })

  // Helper to simulate visibility change
  const triggerVisibilityChange = (): void => {
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('should detect stale on visibility change when timestamps differ', async () => {
    const fetchUpdatedAt = vi.fn().mockResolvedValue('2024-01-15T12:00:00Z')

    const { result } = renderHook(() =>
      useStaleCheck({
        entityId: 'test-id',
        loadedUpdatedAt: '2024-01-15T10:00:00Z', // Older timestamp
        fetchUpdatedAt,
      })
    )

    expect(result.current.isStale).toBe(false)

    await act(async () => {
      triggerVisibilityChange()
    })

    await waitFor(() => {
      expect(result.current.isStale).toBe(true)
    })

    expect(result.current.serverUpdatedAt).toBe('2024-01-15T12:00:00Z')
    expect(fetchUpdatedAt).toHaveBeenCalledWith('test-id')
  })

  it('should not be stale when timestamps match', async () => {
    const fetchUpdatedAt = vi.fn().mockResolvedValue('2024-01-15T10:00:00Z')

    const { result } = renderHook(() =>
      useStaleCheck({
        entityId: 'test-id',
        loadedUpdatedAt: '2024-01-15T10:00:00Z', // Same timestamp
        fetchUpdatedAt,
      })
    )

    await act(async () => {
      triggerVisibilityChange()
    })

    await waitFor(() => {
      expect(fetchUpdatedAt).toHaveBeenCalled()
    })

    expect(result.current.isStale).toBe(false)
    expect(result.current.serverUpdatedAt).toBeNull()
  })

  it('should not check when entityId is undefined', async () => {
    const fetchUpdatedAt = vi.fn().mockResolvedValue('2024-01-15T12:00:00Z')

    renderHook(() =>
      useStaleCheck({
        entityId: undefined,
        loadedUpdatedAt: '2024-01-15T10:00:00Z',
        fetchUpdatedAt,
      })
    )

    await act(async () => {
      triggerVisibilityChange()
    })

    // Give some time for any potential async calls
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(fetchUpdatedAt).not.toHaveBeenCalled()
  })

  it('should not check when loadedUpdatedAt is undefined', async () => {
    const fetchUpdatedAt = vi.fn().mockResolvedValue('2024-01-15T12:00:00Z')

    renderHook(() =>
      useStaleCheck({
        entityId: 'test-id',
        loadedUpdatedAt: undefined,
        fetchUpdatedAt,
      })
    )

    await act(async () => {
      triggerVisibilityChange()
    })

    // Give some time for any potential async calls
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(fetchUpdatedAt).not.toHaveBeenCalled()
  })

  it('should not check when tab is hidden', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })

    const fetchUpdatedAt = vi.fn().mockResolvedValue('2024-01-15T12:00:00Z')

    renderHook(() =>
      useStaleCheck({
        entityId: 'test-id',
        loadedUpdatedAt: '2024-01-15T10:00:00Z',
        fetchUpdatedAt,
      })
    )

    await act(async () => {
      triggerVisibilityChange()
    })

    // Give some time for any potential async calls
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(fetchUpdatedAt).not.toHaveBeenCalled()
  })

  it('should clear stale state with dismiss', async () => {
    const fetchUpdatedAt = vi.fn().mockResolvedValue('2024-01-15T12:00:00Z')

    const { result } = renderHook(() =>
      useStaleCheck({
        entityId: 'test-id',
        loadedUpdatedAt: '2024-01-15T10:00:00Z',
        fetchUpdatedAt,
      })
    )

    await act(async () => {
      triggerVisibilityChange()
    })

    await waitFor(() => {
      expect(result.current.isStale).toBe(true)
    })

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.isStale).toBe(false)
    expect(result.current.serverUpdatedAt).toBeNull()
  })

  it('should handle network errors silently', async () => {
    const fetchUpdatedAt = vi.fn().mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() =>
      useStaleCheck({
        entityId: 'test-id',
        loadedUpdatedAt: '2024-01-15T10:00:00Z',
        fetchUpdatedAt,
      })
    )

    await act(async () => {
      triggerVisibilityChange()
    })

    // Give time for the error to be handled
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should not be stale or deleted - just silently fail
    expect(result.current.isStale).toBe(false)
    expect(result.current.isDeleted).toBe(false)
    expect(fetchUpdatedAt).toHaveBeenCalled()
  })

  it('should set isDeleted when 404 response', async () => {
    const error = { response: { status: 404 } }
    const fetchUpdatedAt = vi.fn().mockRejectedValue(error)

    const { result } = renderHook(() =>
      useStaleCheck({
        entityId: 'test-id',
        loadedUpdatedAt: '2024-01-15T10:00:00Z',
        fetchUpdatedAt,
      })
    )

    await act(async () => {
      triggerVisibilityChange()
    })

    await waitFor(() => {
      expect(result.current.isDeleted).toBe(true)
    })

    expect(result.current.isStale).toBe(false)
  })

  it('should reset state when entityId changes', async () => {
    const fetchUpdatedAt = vi.fn().mockResolvedValue('2024-01-15T12:00:00Z')

    const { result, rerender } = renderHook(
      ({ entityId }) =>
        useStaleCheck({
          entityId,
          loadedUpdatedAt: '2024-01-15T10:00:00Z',
          fetchUpdatedAt,
        }),
      { initialProps: { entityId: 'test-id-1' } }
    )

    await act(async () => {
      triggerVisibilityChange()
    })

    await waitFor(() => {
      expect(result.current.isStale).toBe(true)
    })

    // Change entity ID
    rerender({ entityId: 'test-id-2' })

    // State should be reset
    expect(result.current.isStale).toBe(false)
    expect(result.current.serverUpdatedAt).toBeNull()
  })

  it('should not check again if already showing stale dialog', async () => {
    const fetchUpdatedAt = vi.fn().mockResolvedValue('2024-01-15T12:00:00Z')

    const { result } = renderHook(() =>
      useStaleCheck({
        entityId: 'test-id',
        loadedUpdatedAt: '2024-01-15T10:00:00Z',
        fetchUpdatedAt,
      })
    )

    // First visibility change
    await act(async () => {
      triggerVisibilityChange()
    })

    await waitFor(() => {
      expect(result.current.isStale).toBe(true)
    })

    expect(fetchUpdatedAt).toHaveBeenCalledTimes(1)

    // Second visibility change while stale
    await act(async () => {
      triggerVisibilityChange()
    })

    // Should not call again
    expect(fetchUpdatedAt).toHaveBeenCalledTimes(1)
  })

  it('should clean up event listener on unmount', async () => {
    const fetchUpdatedAt = vi.fn().mockResolvedValue('2024-01-15T12:00:00Z')
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = renderHook(() =>
      useStaleCheck({
        entityId: 'test-id',
        loadedUpdatedAt: '2024-01-15T10:00:00Z',
        fetchUpdatedAt,
      })
    )

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function)
    )

    removeEventListenerSpy.mockRestore()
  })
})
