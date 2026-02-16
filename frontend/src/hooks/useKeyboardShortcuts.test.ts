import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

/**
 * Helper to create a paste event with clipboard data.
 * JSDOM doesn't have ClipboardEvent, so we create a custom event.
 */
function createPasteEvent(text: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  ;(event as Event & { clipboardData: DataTransfer }).clipboardData = {
    getData: () => text,
  } as unknown as DataTransfer
  return event
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up any focused elements
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })

  describe('paste URL handling', () => {
    it('should call onPasteUrl when a valid URL is pasted outside input fields', () => {
      const onPasteUrl = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onPasteUrl }))

      document.dispatchEvent(createPasteEvent('https://example.com'))

      expect(onPasteUrl).toHaveBeenCalledWith('https://example.com')
    })

    it('should call onPasteUrl with trimmed URL', () => {
      const onPasteUrl = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onPasteUrl }))

      document.dispatchEvent(createPasteEvent('  https://example.com  '))

      expect(onPasteUrl).toHaveBeenCalledWith('https://example.com')
    })

    it('should NOT call onPasteUrl when pasted text is not a valid URL (invalid protocol)', () => {
      const onPasteUrl = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onPasteUrl }))

      // Use ftp:// protocol which isValidUrl rejects
      document.dispatchEvent(createPasteEvent('ftp://invalid.com'))

      expect(onPasteUrl).not.toHaveBeenCalled()
    })

    it('should NOT call onPasteUrl when pasted text is plain text', () => {
      const onPasteUrl = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onPasteUrl }))

      document.dispatchEvent(createPasteEvent('just some random text'))

      expect(onPasteUrl).not.toHaveBeenCalled()
    })

    it('should NOT call onPasteUrl when pasted text looks like URL but invalid', () => {
      const onPasteUrl = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onPasteUrl }))

      document.dispatchEvent(createPasteEvent('not://a-valid-url'))

      expect(onPasteUrl).not.toHaveBeenCalled()
    })

    it('should NOT call onPasteUrl when pasting inside an input field', () => {
      const onPasteUrl = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onPasteUrl }))

      // Create and focus an input
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      document.dispatchEvent(createPasteEvent('https://example.com'))

      expect(onPasteUrl).not.toHaveBeenCalled()

      // Cleanup
      document.body.removeChild(input)
    })

    it('should NOT call onPasteUrl when pasting inside a textarea', () => {
      const onPasteUrl = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onPasteUrl }))

      // Create and focus a textarea
      const textarea = document.createElement('textarea')
      document.body.appendChild(textarea)
      textarea.focus()

      document.dispatchEvent(createPasteEvent('https://example.com'))

      expect(onPasteUrl).not.toHaveBeenCalled()

      // Cleanup
      document.body.removeChild(textarea)
    })

    it('should NOT call onPasteUrl when no handler is provided', () => {
      // Should not throw
      renderHook(() => useKeyboardShortcuts({}))

      expect(() => document.dispatchEvent(createPasteEvent('https://example.com'))).not.toThrow()
    })

    it('should NOT call onPasteUrl when clipboard is empty', () => {
      const onPasteUrl = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onPasteUrl }))

      document.dispatchEvent(createPasteEvent(''))

      expect(onPasteUrl).not.toHaveBeenCalled()
    })
  })

  describe('keyboard shortcuts', () => {
    it('should call onFocusSearch when / is pressed outside input fields', () => {
      const onFocusSearch = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onFocusSearch }))

      const keyEvent = new KeyboardEvent('keydown', { key: '/' })
      document.dispatchEvent(keyEvent)

      expect(onFocusSearch).toHaveBeenCalled()
    })

    it('should call onShowShortcuts when Cmd+/ is pressed', () => {
      const onShowShortcuts = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onShowShortcuts }))

      const keyEvent = new KeyboardEvent('keydown', { key: '/', metaKey: true })
      document.dispatchEvent(keyEvent)

      expect(onShowShortcuts).toHaveBeenCalled()
    })

    it('should call onShowShortcuts when Ctrl+/ is pressed (Windows/Linux)', () => {
      const onShowShortcuts = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onShowShortcuts }))

      const keyEvent = new KeyboardEvent('keydown', { key: '/', ctrlKey: true })
      document.dispatchEvent(keyEvent)

      expect(onShowShortcuts).toHaveBeenCalled()
    })

    it('should call onEscape when Escape is pressed', () => {
      const onEscape = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onEscape }))

      const keyEvent = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(keyEvent)

      expect(onEscape).toHaveBeenCalled()
    })

    it('should call onToggleWidth when w is pressed outside input fields', () => {
      const onToggleWidth = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onToggleWidth }))

      const keyEvent = new KeyboardEvent('keydown', { key: 'w' })
      document.dispatchEvent(keyEvent)

      expect(onToggleWidth).toHaveBeenCalled()
    })

    it('should NOT call onToggleWidth when w is pressed inside an input', () => {
      const onToggleWidth = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onToggleWidth }))

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      const keyEvent = new KeyboardEvent('keydown', { key: 'w' })
      document.dispatchEvent(keyEvent)

      expect(onToggleWidth).not.toHaveBeenCalled()

      document.body.removeChild(input)
    })

    it('should call onToggleSidebar when Cmd+\\ is pressed', () => {
      const onToggleSidebar = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onToggleSidebar }))

      const keyEvent = new KeyboardEvent('keydown', { key: '\\', metaKey: true })
      document.dispatchEvent(keyEvent)

      expect(onToggleSidebar).toHaveBeenCalled()
    })

    it('should call onToggleSidebar when Ctrl+\\ is pressed (Windows/Linux)', () => {
      const onToggleSidebar = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onToggleSidebar }))

      const keyEvent = new KeyboardEvent('keydown', { key: '\\', ctrlKey: true })
      document.dispatchEvent(keyEvent)

      expect(onToggleSidebar).toHaveBeenCalled()
    })

    it('should call onToggleHistorySidebar when Cmd+Shift+\\ is pressed', () => {
      const onToggleHistorySidebar = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onToggleHistorySidebar }))

      const keyEvent = new KeyboardEvent('keydown', { key: '\\', metaKey: true, shiftKey: true })
      document.dispatchEvent(keyEvent)

      expect(onToggleHistorySidebar).toHaveBeenCalled()
    })

    it('should call onToggleHistorySidebar when Ctrl+Shift+\\ is pressed (Windows/Linux)', () => {
      const onToggleHistorySidebar = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onToggleHistorySidebar }))

      const keyEvent = new KeyboardEvent('keydown', { key: '\\', ctrlKey: true, shiftKey: true })
      document.dispatchEvent(keyEvent)

      expect(onToggleHistorySidebar).toHaveBeenCalled()
    })

    it('should call onToggleHistorySidebar even when inside an input', () => {
      const onToggleHistorySidebar = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onToggleHistorySidebar }))

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      const keyEvent = new KeyboardEvent('keydown', { key: '\\', metaKey: true, shiftKey: true })
      document.dispatchEvent(keyEvent)

      expect(onToggleHistorySidebar).toHaveBeenCalled()

      document.body.removeChild(input)
    })

    it('should NOT call onToggleSidebar when Cmd+Shift+\\ is pressed (should call onToggleHistorySidebar instead)', () => {
      const onToggleSidebar = vi.fn()
      const onToggleHistorySidebar = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onToggleSidebar, onToggleHistorySidebar }))

      const keyEvent = new KeyboardEvent('keydown', { key: '\\', metaKey: true, shiftKey: true })
      document.dispatchEvent(keyEvent)

      expect(onToggleSidebar).not.toHaveBeenCalled()
      expect(onToggleHistorySidebar).toHaveBeenCalled()
    })

    it('should call onCommandPalette when Cmd+Shift+P is pressed (uppercase P from Shift)', () => {
      const onCommandPalette = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onCommandPalette }))

      const keyEvent = new KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true })
      document.dispatchEvent(keyEvent)

      expect(onCommandPalette).toHaveBeenCalled()
    })

    it('should call onCommandPalette when Ctrl+Shift+P is pressed (Windows/Linux)', () => {
      const onCommandPalette = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onCommandPalette }))

      const keyEvent = new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true })
      document.dispatchEvent(keyEvent)

      expect(onCommandPalette).toHaveBeenCalled()
    })

    it('should call onCommandPalette even when inside an input', () => {
      const onCommandPalette = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onCommandPalette }))

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      const keyEvent = new KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true })
      document.dispatchEvent(keyEvent)

      expect(onCommandPalette).toHaveBeenCalled()

      document.body.removeChild(input)
    })

    it('should call onToggleSidebar even when inside an input (like VS Code)', () => {
      const onToggleSidebar = vi.fn()
      renderHook(() => useKeyboardShortcuts({ onToggleSidebar }))

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      const keyEvent = new KeyboardEvent('keydown', { key: '\\', metaKey: true })
      document.dispatchEvent(keyEvent)

      expect(onToggleSidebar).toHaveBeenCalled()

      document.body.removeChild(input)
    })
  })
})
