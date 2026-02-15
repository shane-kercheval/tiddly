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
    const removeWindowEventListenerSpy = vi.spyOn(window, 'removeEventListener')

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
    expect(removeWindowEventListenerSpy).toHaveBeenCalledWith(
      'focus',
      expect.any(Function)
    )

    removeEventListenerSpy.mockRestore()
    removeWindowEventListenerSpy.mockRestore()
  })

  it('should detect stale on window focus', async () => {
    const fetchUpdatedAt = vi.fn().mockResolvedValue('2024-01-15T12:00:00Z')

    const { result } = renderHook(() =>
      useStaleCheck({
        entityId: 'test-id',
        loadedUpdatedAt: '2024-01-15T10:00:00Z',
        fetchUpdatedAt,
      })
    )

    expect(result.current.isStale).toBe(false)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(result.current.isStale).toBe(true)
    })

    expect(fetchUpdatedAt).toHaveBeenCalledWith('test-id')
  })

  it('should not double-fire on visibilitychange + focus (in-flight guard)', async () => {
    let resolvePromise: (value: string) => void
    const slowFetchUpdatedAt = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvePromise = resolve
        })
    )

    renderHook(() =>
      useStaleCheck({
        entityId: 'test-id',
        loadedUpdatedAt: '2024-01-15T10:00:00Z',
        fetchUpdatedAt: slowFetchUpdatedAt,
      })
    )

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })

    expect(slowFetchUpdatedAt).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolvePromise!('2024-01-15T10:00:00Z')
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })

    expect(slowFetchUpdatedAt).toHaveBeenCalledTimes(2)
  })

  it('should not update state if entity changes during fetch (race condition guard)', async () => {
    // Create a deferred promise that we can resolve manually
    let resolvePromise: (value: string) => void
    const slowFetchUpdatedAt = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvePromise = resolve
        })
    )

    const { result, rerender } = renderHook(
      ({ entityId, loadedUpdatedAt }) =>
        useStaleCheck({
          entityId,
          loadedUpdatedAt,
          fetchUpdatedAt: slowFetchUpdatedAt,
        }),
      {
        initialProps: {
          entityId: 'entity-1',
          loadedUpdatedAt: '2024-01-15T10:00:00Z',
        },
      }
    )

    // Trigger visibility change - starts fetch for entity-1
    await act(async () => {
      triggerVisibilityChange()
    })

    expect(slowFetchUpdatedAt).toHaveBeenCalledWith('entity-1')

    // User navigates to different entity BEFORE fetch completes
    rerender({
      entityId: 'entity-2',
      loadedUpdatedAt: '2024-01-15T11:00:00Z',
    })

    // State should be reset for the new entity
    expect(result.current.isStale).toBe(false)

    // Now the old fetch completes with a stale timestamp
    await act(async () => {
      resolvePromise!('2024-01-15T12:00:00Z') // Would be stale for entity-1
    })

    // Give time for any state updates
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should NOT set stale state because entity changed
    expect(result.current.isStale).toBe(false)
    expect(result.current.serverUpdatedAt).toBeNull()
  })

  it('should not set deleted state if entity changes during failed fetch', async () => {
    // Create a deferred promise that we can reject manually
    let rejectPromise: (error: unknown) => void
    const slowFetchUpdatedAt = vi.fn().mockImplementation(
      () =>
        new Promise<string>((_, reject) => {
          rejectPromise = reject
        })
    )

    const { result, rerender } = renderHook(
      ({ entityId, loadedUpdatedAt }) =>
        useStaleCheck({
          entityId,
          loadedUpdatedAt,
          fetchUpdatedAt: slowFetchUpdatedAt,
        }),
      {
        initialProps: {
          entityId: 'entity-1',
          loadedUpdatedAt: '2024-01-15T10:00:00Z',
        },
      }
    )

    // Trigger visibility change - starts fetch for entity-1
    await act(async () => {
      triggerVisibilityChange()
    })

    // User navigates to different entity BEFORE fetch completes
    rerender({
      entityId: 'entity-2',
      loadedUpdatedAt: '2024-01-15T11:00:00Z',
    })

    // Now the old fetch fails with 404
    await act(async () => {
      rejectPromise!({ response: { status: 404 } })
    })

    // Give time for any state updates
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should NOT set deleted state because entity changed
    expect(result.current.isDeleted).toBe(false)
  })

  it('should not set stale if loadedUpdatedAt changes during fetch (refresh race condition)', async () => {
    // Scenario: User clicks "Load Latest Version" which refreshes the entity,
    // updating loadedUpdatedAt. Meanwhile, an old stale-check fetch resolves.
    // The old fetch should NOT trigger isStale because loadedUpdatedAt changed.

    let resolvePromise: (value: string) => void
    const slowFetchUpdatedAt = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvePromise = resolve
        })
    )

    const { result, rerender } = renderHook(
      ({ entityId, loadedUpdatedAt }) =>
        useStaleCheck({
          entityId,
          loadedUpdatedAt,
          fetchUpdatedAt: slowFetchUpdatedAt,
        }),
      {
        initialProps: {
          entityId: 'entity-1',
          loadedUpdatedAt: '2024-01-15T10:00:00Z', // Original timestamp
        },
      }
    )

    // Trigger visibility change - starts fetch
    await act(async () => {
      triggerVisibilityChange()
    })

    expect(slowFetchUpdatedAt).toHaveBeenCalledWith('entity-1')

    // User refreshes the entity (e.g., clicked "Load Latest Version")
    // This updates loadedUpdatedAt to the server's current value
    rerender({
      entityId: 'entity-1', // Same entity
      loadedUpdatedAt: '2024-01-15T12:00:00Z', // Updated to match server
    })

    // Now the old fetch resolves with the server timestamp
    await act(async () => {
      resolvePromise!('2024-01-15T12:00:00Z')
    })

    // Give time for any state updates
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should NOT set stale because loadedUpdatedAt was updated during fetch
    // (the entity is now up-to-date)
    expect(result.current.isStale).toBe(false)
    expect(result.current.serverUpdatedAt).toBeNull()
  })

  it('should not set deleted if loadedUpdatedAt changes during failed fetch', async () => {
    // Same scenario but with 404 error
    let rejectPromise: (error: unknown) => void
    const slowFetchUpdatedAt = vi.fn().mockImplementation(
      () =>
        new Promise<string>((_, reject) => {
          rejectPromise = reject
        })
    )

    const { result, rerender } = renderHook(
      ({ entityId, loadedUpdatedAt }) =>
        useStaleCheck({
          entityId,
          loadedUpdatedAt,
          fetchUpdatedAt: slowFetchUpdatedAt,
        }),
      {
        initialProps: {
          entityId: 'entity-1',
          loadedUpdatedAt: '2024-01-15T10:00:00Z',
        },
      }
    )

    // Trigger visibility change - starts fetch
    await act(async () => {
      triggerVisibilityChange()
    })

    // Entity gets refreshed, updating loadedUpdatedAt
    rerender({
      entityId: 'entity-1',
      loadedUpdatedAt: '2024-01-15T12:00:00Z',
    })

    // Old fetch fails with 404
    await act(async () => {
      rejectPromise!({ response: { status: 404 } })
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should NOT set deleted because loadedUpdatedAt changed
    expect(result.current.isDeleted).toBe(false)
  })

  it('should prevent concurrent requests with in-flight guard', async () => {
    let resolvePromise: (value: string) => void
    const slowFetchUpdatedAt = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvePromise = resolve
        })
    )

    const { result } = renderHook(() =>
      useStaleCheck({
        entityId: 'test-id',
        loadedUpdatedAt: '2024-01-15T10:00:00Z',
        fetchUpdatedAt: slowFetchUpdatedAt,
      })
    )

    // First visibility change - starts fetch
    await act(async () => {
      triggerVisibilityChange()
    })

    expect(slowFetchUpdatedAt).toHaveBeenCalledTimes(1)

    // Rapid second visibility change while first is in-flight
    await act(async () => {
      triggerVisibilityChange()
    })

    // Should NOT start another fetch
    expect(slowFetchUpdatedAt).toHaveBeenCalledTimes(1)

    // Third visibility change
    await act(async () => {
      triggerVisibilityChange()
    })

    // Still should NOT start another fetch
    expect(slowFetchUpdatedAt).toHaveBeenCalledTimes(1)

    // Complete the first fetch (not stale)
    await act(async () => {
      resolvePromise!('2024-01-15T10:00:00Z')
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(result.current.isStale).toBe(false)

    // Now a new visibility change should work
    await act(async () => {
      triggerVisibilityChange()
    })

    expect(slowFetchUpdatedAt).toHaveBeenCalledTimes(2)
  })
})
