import { describe, it, expect, vi, afterEach } from 'vitest'
import { dispatchRegistryShortcut } from './dispatch'
import type { ShortcutId } from './registry'

function mockPlatform(value: string): void {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(value)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('dispatchRegistryShortcut', () => {
  it('synthesizes a keydown event matching the entry and dispatches to document', () => {
    mockPlatform('MacIntel')
    const captured: KeyboardEvent[] = []
    const listener = (e: Event): void => {
      captured.push(e as KeyboardEvent)
    }
    document.addEventListener('keydown', listener)

    dispatchRegistryShortcut('app.showShortcuts')

    expect(captured).toHaveLength(1)
    expect(captured[0].key).toBe('/')
    expect(captured[0].metaKey).toBe(true)
    expect(captured[0].ctrlKey).toBe(false)
    expect(captured[0].shiftKey).toBe(true)
    expect(captured[0].altKey).toBe(false)

    document.removeEventListener('keydown', listener)
  })

  it('uses ctrlKey on Windows/Linux for `mod: true`', () => {
    mockPlatform('Win32')
    const captured: KeyboardEvent[] = []
    const listener = (e: Event): void => {
      captured.push(e as KeyboardEvent)
    }
    document.addEventListener('keydown', listener)

    dispatchRegistryShortcut('app.showShortcuts')

    expect(captured[0].metaKey).toBe(false)
    expect(captured[0].ctrlKey).toBe(true)

    document.removeEventListener('keydown', listener)
  })

  it('does not synthesize unwanted modifiers (preserves strict-match contract)', () => {
    // app.escape has no modifiers in its match. Dispatching must produce a bare
    // Escape event, not Escape+meta or similar — otherwise the bubble matcher
    // wouldn't fire.
    mockPlatform('MacIntel')
    const captured: KeyboardEvent[] = []
    const listener = (e: Event): void => {
      captured.push(e as KeyboardEvent)
    }
    document.addEventListener('keydown', listener)

    dispatchRegistryShortcut('app.escape')

    expect(captured[0].key).toBe('Escape')
    expect(captured[0].metaKey).toBe(false)
    expect(captured[0].ctrlKey).toBe(false)
    expect(captured[0].shiftKey).toBe(false)
    expect(captured[0].altKey).toBe(false)

    document.removeEventListener('keydown', listener)
  })

  it('throws on unknown id (registry backstop)', () => {
    expect(() => dispatchRegistryShortcut('app.nonexistent' as ShortcutId)).toThrow(
      /Unknown shortcut id/,
    )
  })
})

// The next three throw-paths are guarded against the registry shape, which
// in M2 doesn't yet have any display-only or code-based entries. We mock
// the registry / capturePhase modules to inject test fixtures and verify the
// guards fire. M3 will exercise these with real entries; until then, the
// guards are real load-bearing checks and deserve test coverage.
describe('dispatchRegistryShortcut — throw paths (mocked fixtures)', () => {
  it('throws on display-only entry (no match)', async () => {
    vi.resetModules()
    vi.doMock('./registry', async () => {
      const actual = await vi.importActual<typeof import('./registry')>('./registry')
      return {
        ...actual,
        getShortcut: () => ({
          id: 'fixture.displayOnly',
          label: 'Display Only',
          section: 'Test',
          keys: ['⌘', 'Click'] as const,
          // no match — display-only entry
        }),
      }
    })
    const { dispatchRegistryShortcut: dispatchMocked } = await import('./dispatch')
    expect(() => dispatchMocked('fixture.displayOnly' as ShortcutId)).toThrow(
      /no match.*display-only/,
    )
    vi.doUnmock('./registry')
  })

  it('throws when id is in CAPTURE_PHASE_IDS', async () => {
    vi.resetModules()
    vi.doMock('./capturePhase', () => ({
      CAPTURE_PHASE_IDS: ['app.escape'] as const,
    }))
    const { dispatchRegistryShortcut: dispatchMocked } = await import('./dispatch')
    expect(() => dispatchMocked('app.escape')).toThrow(
      /capture-phase id.*synthetic dispatch would double-fire/,
    )
    vi.doUnmock('./capturePhase')
  })

  it('throws on code-based entry', async () => {
    vi.resetModules()
    vi.doMock('./registry', async () => {
      const actual = await vi.importActual<typeof import('./registry')>('./registry')
      return {
        ...actual,
        getShortcut: () => ({
          id: 'fixture.codeBased',
          label: 'Toggle Wrap',
          section: 'View',
          keys: ['⌥', 'Z'] as const,
          match: { alt: true, code: 'KeyZ' as const },
        }),
      }
    })
    const { dispatchRegistryShortcut: dispatchMocked } = await import('./dispatch')
    expect(() => dispatchMocked('fixture.codeBased' as ShortcutId)).toThrow(
      /match\.code.*capture-phase concern/,
    )
    vi.doUnmock('./registry')
  })
})
