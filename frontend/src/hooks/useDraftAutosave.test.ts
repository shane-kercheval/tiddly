/**
 * Tests for the draft-autosave hook (plan M3 step 8): periodic snapshots
 * while dirty, cleared on save, restore prompt on remount, and the
 * mount-with-lingering-draft case that must NOT self-destruct.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDraftAutosave, type SavedDraft } from './useDraftAutosave'

interface FormState {
  title: string
  content: string
}

const KEY = 'tiddly:draft:test:1'

function readStored(): SavedDraft<FormState> | null {
  const raw = localStorage.getItem(KEY)
  return raw ? (JSON.parse(raw) as SavedDraft<FormState>) : null
}

describe('useDraftAutosave', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes a snapshot after the interval while dirty, not per change', () => {
    const { rerender } = renderHook(
      ({ current, isDirty }: { current: FormState; isDirty: boolean }) =>
        useDraftAutosave({ storageKey: KEY, current, isDirty }),
      { initialProps: { current: { title: '', content: '' }, isDirty: false } },
    )

    rerender({ current: { title: 'a', content: 'typing' }, isDirty: true })
    expect(readStored()).toBeNull() // nothing until the interval fires

    act(() => vi.advanceTimersByTime(2100))
    expect(readStored()?.data).toEqual({ title: 'a', content: 'typing' })

    // Keep typing: the next snapshot captures the latest state.
    rerender({ current: { title: 'a', content: 'typing more' }, isDirty: true })
    act(() => vi.advanceTimersByTime(2100))
    expect(readStored()?.data.content).toBe('typing more')
  })

  it('clears the draft when the form returns to clean (saved)', () => {
    const { rerender } = renderHook(
      ({ current, isDirty }: { current: FormState; isDirty: boolean }) =>
        useDraftAutosave({ storageKey: KEY, current, isDirty }),
      { initialProps: { current: { title: '', content: '' }, isDirty: false } },
    )

    rerender({ current: { title: 'a', content: 'x' }, isDirty: true })
    act(() => vi.advanceTimersByTime(2100))
    expect(readStored()).not.toBeNull()

    // Save completes: original catches up, isDirty falls false.
    rerender({ current: { title: 'a', content: 'x' }, isDirty: false })
    expect(readStored()).toBeNull()
  })

  it('clearDraft removes the current key — the create path (:new -> :id) leaves no orphan', () => {
    // A successful CREATE navigates the editor to the new item id, changing
    // the key. clearDraft() (called from the save-success path, before the
    // key change matters) removes the ':new' draft so the next create isn't
    // offered stale, already-saved content.
    const NEW_KEY = 'tiddly:draft:note:new'
    const { result, rerender } = renderHook(
      ({ storageKey, current, isDirty }: { storageKey: string; current: FormState; isDirty: boolean }) =>
        useDraftAutosave({ storageKey, current, isDirty }),
      { initialProps: { storageKey: NEW_KEY, current: { title: '', content: '' }, isDirty: false } },
    )

    // Type a new note; a snapshot lands under ':new'.
    rerender({ storageKey: NEW_KEY, current: { title: 'fresh', content: 'note' }, isDirty: true })
    act(() => vi.advanceTimersByTime(2100))
    expect(localStorage.getItem(NEW_KEY)).not.toBeNull()

    // Save success: clear, then the component re-keys to the created id.
    act(() => result.current.clearDraft())
    expect(localStorage.getItem(NEW_KEY)).toBeNull()

    rerender({ storageKey: 'tiddly:draft:note:abc123', current: { title: 'fresh', content: 'note' }, isDirty: false })
    // A brand-new create session finds nothing lingering under ':new'.
    const { result: fresh } = renderHook(() =>
      useDraftAutosave<FormState>({ storageKey: NEW_KEY, current: { title: '', content: '' }, isDirty: false }),
    )
    expect(fresh.current.pendingDraft).toBeNull()
  })

  it('item-switch between two existing items preserves both drafts (clearDraft not involved)', () => {
    const KEY_A = 'tiddly:draft:note:a'
    const KEY_B = 'tiddly:draft:note:b'
    localStorage.setItem(KEY_B, JSON.stringify({ data: { title: 'b-draft', content: '' }, savedAt: Date.now() }))

    const { rerender } = renderHook(
      ({ storageKey, current, isDirty }: { storageKey: string; current: FormState; isDirty: boolean }) =>
        useDraftAutosave({ storageKey, current, isDirty }),
      { initialProps: { storageKey: KEY_A, current: { title: '', content: '' }, isDirty: false } },
    )

    // Edit item A, snapshot lands under A.
    rerender({ storageKey: KEY_A, current: { title: 'a-edit', content: '' }, isDirty: true })
    act(() => vi.advanceTimersByTime(2100))
    expect(localStorage.getItem(KEY_A)).not.toBeNull()

    // Navigate to item B without saving: A's draft must survive, B's is intact.
    rerender({ storageKey: KEY_B, current: { title: 'b', content: '' }, isDirty: false })
    expect(localStorage.getItem(KEY_A)).not.toBeNull()
    expect(localStorage.getItem(KEY_B)).not.toBeNull()
  })

  it('mounting clean over a lingering draft does NOT delete it — it becomes the restore prompt', () => {
    const lingering: SavedDraft<FormState> = {
      data: { title: 'recovered', content: 'from a crash' },
      savedAt: Date.now() - 60_000,
    }
    localStorage.setItem(KEY, JSON.stringify(lingering))

    const { result } = renderHook(() =>
      useDraftAutosave<FormState>({
        storageKey: KEY,
        current: { title: 'server copy', content: 'server copy' },
        isDirty: false,
      }),
    )

    expect(result.current.pendingDraft?.data.title).toBe('recovered')
    expect(readStored()).not.toBeNull() // still in storage until the user decides
  })

  it('restoreDraft hands back the data and resolves the prompt', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ data: { title: 't', content: 'c' }, savedAt: Date.now() }),
    )
    const { result } = renderHook(() =>
      useDraftAutosave<FormState>({
        storageKey: KEY,
        current: { title: '', content: '' },
        isDirty: false,
      }),
    )

    let restored: FormState | null = null
    act(() => {
      restored = result.current.restoreDraft()
    })
    expect(restored).toEqual({ title: 't', content: 'c' })
    expect(result.current.pendingDraft).toBeNull()
  })

  it('discardDraft deletes the stored draft and resolves the prompt', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ data: { title: 't', content: 'c' }, savedAt: Date.now() }),
    )
    const { result } = renderHook(() =>
      useDraftAutosave<FormState>({
        storageKey: KEY,
        current: { title: '', content: '' },
        isDirty: false,
      }),
    )

    act(() => {
      result.current.discardDraft()
    })
    expect(result.current.pendingDraft).toBeNull()
    expect(readStored()).toBeNull()
  })

  it('disabled (read-only) never writes and surfaces no prompt', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ data: { title: 't', content: 'c' }, savedAt: Date.now() }),
    )
    const { result, rerender } = renderHook(
      ({ current, isDirty }: { current: FormState; isDirty: boolean }) =>
        useDraftAutosave({ storageKey: KEY, current, isDirty, disabled: true }),
      { initialProps: { current: { title: '', content: '' }, isDirty: false } },
    )

    expect(result.current.pendingDraft).toBeNull()
    rerender({ current: { title: 'x', content: 'y' }, isDirty: true })
    act(() => vi.advanceTimersByTime(5000))
    // The lingering draft is untouched and no new snapshot replaced it.
    expect(readStored()?.data.title).toBe('t')
  })

  it('corrupt stored JSON is treated as no draft', () => {
    localStorage.setItem(KEY, '{not json')
    const { result } = renderHook(() =>
      useDraftAutosave<FormState>({
        storageKey: KEY,
        current: { title: '', content: '' },
        isDirty: false,
      }),
    )
    expect(result.current.pendingDraft).toBeNull()
  })

  it('re-arms when the storage key changes (navigating between items)', () => {
    const otherKey = 'tiddly:draft:test:2'
    localStorage.setItem(
      otherKey,
      JSON.stringify({ data: { title: 'other', content: '' }, savedAt: Date.now() }),
    )
    const { result, rerender } = renderHook(
      ({ storageKey }: { storageKey: string }) =>
        useDraftAutosave<FormState>({
          storageKey,
          current: { title: '', content: '' },
          isDirty: false,
        }),
      { initialProps: { storageKey: KEY } },
    )
    expect(result.current.pendingDraft).toBeNull()

    rerender({ storageKey: otherKey })
    expect(result.current.pendingDraft?.data.title).toBe('other')
  })
})
