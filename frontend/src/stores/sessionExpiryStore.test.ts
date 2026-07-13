/**
 * Tests for the session-expiry request-parking contract (plan M3 step 7):
 * parked requests replay after re-auth, fail cleanly on reset (logout), and
 * the store never navigates or clears anything — it only orchestrates retries.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSessionExpiryStore } from './sessionExpiryStore'

function resetStore(): void {
  useSessionExpiryStore.setState({ expired: false, deliberateLogout: false, pending: [] })
}

describe('sessionExpiryStore', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('parkRequest marks the session expired and holds the request unsettled', async () => {
    const retry = vi.fn().mockResolvedValue('replayed')
    const parked = useSessionExpiryStore.getState().parkRequest(retry, new Error('401'))

    expect(useSessionExpiryStore.getState().expired).toBe(true)
    expect(useSessionExpiryStore.getState().pending).toHaveLength(1)
    expect(retry).not.toHaveBeenCalled()

    // Prevent unhandled rejection noise when the test ends.
    useSessionExpiryStore.getState().resumeAll()
    await expect(parked).resolves.toBe('replayed')
  })

  it('resumeAll replays every parked request and settles their promises', async () => {
    const store = useSessionExpiryStore.getState()
    const first = store.parkRequest(vi.fn().mockResolvedValue('a'), new Error('401'))
    const second = store.parkRequest(vi.fn().mockResolvedValue('b'), new Error('401'))

    useSessionExpiryStore.getState().resumeAll()

    await expect(first).resolves.toBe('a')
    await expect(second).resolves.toBe('b')
    expect(useSessionExpiryStore.getState().expired).toBe(false)
    expect(useSessionExpiryStore.getState().pending).toHaveLength(0)
  })

  it('a replay that fails again rejects its own caller only', async () => {
    const store = useSessionExpiryStore.getState()
    const ok = store.parkRequest(vi.fn().mockResolvedValue('a'), new Error('401'))
    const bad = store.parkRequest(
      vi.fn().mockRejectedValue(new Error('still broken')),
      new Error('401'),
    )

    useSessionExpiryStore.getState().resumeAll()

    await expect(ok).resolves.toBe('a')
    await expect(bad).rejects.toThrow('still broken')
  })

  it('markExpired raises the dialog with nothing parked (client-detected death)', () => {
    useSessionExpiryStore.getState().markExpired()
    const state = useSessionExpiryStore.getState()
    expect(state.expired).toBe(true)
    expect(state.pending).toHaveLength(0)
  })

  it('deliberateLogout flag: begin sets it, clear removes it, reset leaves it to begin()', () => {
    useSessionExpiryStore.getState().beginDeliberateLogout()
    expect(useSessionExpiryStore.getState().deliberateLogout).toBe(true)
    useSessionExpiryStore.getState().clearDeliberateLogout()
    expect(useSessionExpiryStore.getState().deliberateLogout).toBe(false)
  })

  it('reset (deliberate logout) drops everything and fails parked requests', async () => {
    const originalError = new Error('original 401')
    const parked = useSessionExpiryStore.getState().parkRequest(vi.fn(), originalError)

    useSessionExpiryStore.getState().reset()

    await expect(parked).rejects.toBe(originalError)
    const state = useSessionExpiryStore.getState()
    expect(state.expired).toBe(false)
    expect(state.pending).toHaveLength(0)
  })
})
