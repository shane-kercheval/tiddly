import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGlobalShortcuts, assertNoDuplicateMatchShapes } from './useGlobalShortcuts'
import type { ShortcutId } from './registry'
import type { Shortcut } from './types'

const APP_GLOBAL_IDS = [
  'app.showShortcuts',
  'app.commandPalette',
  'app.toggleSidebar',
  'app.toggleHistorySidebar',
  'app.escape',
  'app.focusSearch',
  'app.focusPageSearch',
  'app.toggleWidth',
] as const satisfies readonly ShortcutId[]

type Handlers = Record<typeof APP_GLOBAL_IDS[number], () => void>

function buildNoOpHandlers(): Handlers {
  return APP_GLOBAL_IDS.reduce<Partial<Handlers>>((acc, id) => {
    acc[id] = vi.fn()
    return acc
  }, {}) as Handlers
}

describe('useGlobalShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })

  it('fires the matched handler on keydown', () => {
    const handlers = buildNoOpHandlers()
    renderHook(() => useGlobalShortcuts(APP_GLOBAL_IDS, handlers))

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '/', metaKey: true, shiftKey: true }),
    )
    expect(handlers['app.showShortcuts']).toHaveBeenCalledTimes(1)
  })

  it('fires Cmd+Shift+P with metaKey (Mac)', () => {
    const handlers = buildNoOpHandlers()
    renderHook(() => useGlobalShortcuts(APP_GLOBAL_IDS, handlers))

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true }),
    )
    expect(handlers['app.commandPalette']).toHaveBeenCalledTimes(1)
  })

  it('fires Ctrl+Shift+P (Windows/Linux)', () => {
    const handlers = buildNoOpHandlers()
    renderHook(() => useGlobalShortcuts(APP_GLOBAL_IDS, handlers))

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }),
    )
    expect(handlers['app.commandPalette']).toHaveBeenCalledTimes(1)
  })

  it('does not fire bare-key shortcuts while an input is focused', () => {
    const handlers = buildNoOpHandlers()
    renderHook(() => useGlobalShortcuts(APP_GLOBAL_IDS, handlers))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    expect(handlers['app.toggleWidth']).not.toHaveBeenCalled()

    document.body.removeChild(input)
  })

  it('fires `allowInInputs: true` shortcuts even when an input is focused', () => {
    const handlers = buildNoOpHandlers()
    renderHook(() => useGlobalShortcuts(APP_GLOBAL_IDS, handlers))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '\\', metaKey: true }),
    )
    expect(handlers['app.toggleSidebar']).toHaveBeenCalledTimes(1)

    document.body.removeChild(input)
  })

  it('disambiguates Cmd+\\ vs Cmd+Shift+\\', () => {
    const handlers = buildNoOpHandlers()
    renderHook(() => useGlobalShortcuts(APP_GLOBAL_IDS, handlers))

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '\\', metaKey: true, shiftKey: true }),
    )
    expect(handlers['app.toggleHistorySidebar']).toHaveBeenCalledTimes(1)
    expect(handlers['app.toggleSidebar']).not.toHaveBeenCalled()
  })

  it('calls preventDefault by default', () => {
    const handlers = buildNoOpHandlers()
    renderHook(() => useGlobalShortcuts(APP_GLOBAL_IDS, handlers))

    const event = new KeyboardEvent('keydown', { key: 'w', cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('respects preventDefault: false on Escape', () => {
    const handlers = buildNoOpHandlers()
    renderHook(() => useGlobalShortcuts(APP_GLOBAL_IDS, handlers))

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    document.dispatchEvent(event)
    expect(handlers['app.escape']).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })

  describe('multi-mount', () => {
    it('disjoint mounts: each runs its own handlers', () => {
      const layoutHandlers = buildNoOpHandlers()
      const allContentEscape = vi.fn()

      const layout = renderHook(() => useGlobalShortcuts(APP_GLOBAL_IDS, layoutHandlers))
      const allContent = renderHook(() =>
        useGlobalShortcuts(['app.escape', 'app.focusPageSearch'] as const, {
          'app.escape': allContentEscape,
          'app.focusPageSearch': vi.fn(),
        }),
      )

      // Cmd+Shift+/ is only in the Layout tuple.
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '/', metaKey: true, shiftKey: true }),
      )
      expect(layoutHandlers['app.showShortcuts']).toHaveBeenCalledTimes(1)
      expect(allContentEscape).not.toHaveBeenCalled()

      layout.unmount()
      allContent.unmount()
    })

    it('overlapping ids: both handlers fire on a matching event (Escape contract)', () => {
      const layoutEscape = vi.fn()
      const allContentEscape = vi.fn()

      const layout = renderHook(() =>
        useGlobalShortcuts(['app.escape'] as const, { 'app.escape': layoutEscape }),
      )
      const allContent = renderHook(() =>
        useGlobalShortcuts(['app.escape'] as const, { 'app.escape': allContentEscape }),
      )

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

      // Both handlers must run: one closes the dialog, the other blurs the input.
      expect(layoutEscape).toHaveBeenCalledTimes(1)
      expect(allContentEscape).toHaveBeenCalledTimes(1)

      layout.unmount()
      allContent.unmount()
    })
  })

  describe('listener install stability', () => {
    it('installs the keydown listener exactly once across multiple rerenders, even with inline tuples', () => {
      // Inline `[...] as const` produces a fresh array reference every render.
      // The hook keys its install effect on JSON.stringify(ids), so a stable
      // tuple shape doesn't churn the listener.
      const addSpy = vi.spyOn(document, 'addEventListener')

      const { rerender } = renderHook<void, { handler: () => void }>(
        ({ handler }) =>
          useGlobalShortcuts(['app.escape'] as const, { 'app.escape': handler }),
        { initialProps: { handler: vi.fn() } },
      )

      const callsBefore = addSpy.mock.calls.filter(([type]) => type === 'keydown').length
      act(() => {
        rerender({ handler: vi.fn() })
        rerender({ handler: vi.fn() })
        rerender({ handler: vi.fn() })
      })
      const callsAfter = addSpy.mock.calls.filter(([type]) => type === 'keydown').length

      expect(callsAfter).toBe(callsBefore) // no additional installs on rerender

      addSpy.mockRestore()
    })

    it('reads the latest handler through the ref after a re-render', () => {
      const first = vi.fn()
      const second = vi.fn()
      const { rerender } = renderHook(
        ({ handlers }) => useGlobalShortcuts(['app.escape'] as const, handlers),
        { initialProps: { handlers: { 'app.escape': first } } },
      )

      act(() => {
        rerender({ handlers: { 'app.escape': second } })
      })

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledTimes(1)
    })
  })

  describe('dev-mode duplicate-match invariant', () => {
    it('throws when two distinct ids have byte-equal match shapes (the realistic failure)', () => {
      // The realistic clash: two different ids whose `match` shapes happen
      // to canonicalize identically. Hits the invariant via the exported
      // helper with synthetic fixtures (no registry mock needed).
      const fixtures: Shortcut[] = [
        { id: 'fixture.foo', label: 'Foo', section: 'X', keys: ['⌘', 'B'], match: { mod: true, key: 'b' } },
        { id: 'fixture.bar', label: 'Bar', section: 'X', keys: ['⌘', 'B'], match: { mod: true, key: 'b' } },
      ]
      expect(() => assertNoDuplicateMatchShapes(fixtures)).toThrow(
        /duplicate match shape.*fixture\.foo.*fixture\.bar/,
      )
    })

    it('error message includes the canonical match shape for debugging', () => {
      const fixtures: Shortcut[] = [
        { id: 'fixture.a', label: 'A', section: 'X', keys: ['⌘', 'B'], match: { mod: true, key: 'b' } },
        { id: 'fixture.b', label: 'B', section: 'X', keys: ['⌘', 'B'], match: { mod: true, key: 'b' } },
      ]
      expect(() => assertNoDuplicateMatchShapes(fixtures)).toThrow(/"key":"b"/)
    })

    it('passes when match shapes differ even slightly (shift flag)', () => {
      const fixtures: Shortcut[] = [
        { id: 'fixture.a', label: 'A', section: 'X', keys: ['⌘', 'B'], match: { mod: true, key: 'b' } },
        { id: 'fixture.b', label: 'B', section: 'X', keys: ['⌘', '⇧', 'B'], match: { mod: true, shift: true, key: 'b' } },
      ]
      expect(() => assertNoDuplicateMatchShapes(fixtures)).not.toThrow()
    })

    it('skips display-only entries (no match)', () => {
      const fixtures: Shortcut[] = [
        { id: 'fixture.a', label: 'A', section: 'X', keys: ['⌘', 'Click'] },
        { id: 'fixture.b', label: 'B', section: 'X', keys: ['⇧', 'Click'] },
      ]
      expect(() => assertNoDuplicateMatchShapes(fixtures)).not.toThrow()
    })

    it('throws via the hook when registered tuple has duplicate-match-shape entries', () => {
      // Same id twice exercises the integration path: hook → invariant.
      // Distinct-id path is covered by the helper-level tests above.
      expect(() => {
        renderHook(() =>
          useGlobalShortcuts(['app.escape', 'app.escape'] as const, {
            'app.escape': vi.fn(),
          }),
        )
      }).toThrow(/duplicate match shape/)
    })
  })
})
