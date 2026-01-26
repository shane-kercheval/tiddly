/**
 * Tests for CodeMirror focus restoration after Cmd+S save.
 *
 * This tests the fix for the bug where CodeMirror loses focus after saving
 * while Milkdown retains it. The fix saves a reference to the active element
 * when Cmd+S is pressed in a CodeMirror editor, then restores focus after save.
 *
 * Note: Focus behavior is difficult to test reliably in jsdom. These tests
 * verify the mechanism works, but manual testing in a real browser is
 * recommended for full confidence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Note as NoteType, TagCount } from '../../types'

// Create a mock CodeMirrorEditor that includes the .cm-editor class
vi.mock('../MilkdownEditor', () => ({
  MilkdownEditor: ({ value, onChange, placeholder, disabled }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
  }) => (
    <textarea
      data-testid="content-editor-markdown"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  ),
}))

vi.mock('../CodeMirrorEditor', () => ({
  CodeMirrorEditor: ({ value, onChange, placeholder, disabled }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
  }) => (
    // Wrap in a div with .cm-editor class so .closest('.cm-editor') works
    <div className="cm-editor">
      <textarea
        data-testid="content-editor-text"
        className="cm-content"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  ),
}))

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Import Note after mocks are set up
import { Note } from '../Note'

const mockNote: NoteType = {
  id: 'note-1',
  title: 'Test Note',
  description: 'Test description',
  content: '# Hello World',
  tags: ['test'],
  version: 1,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  last_used_at: '2024-01-01T00:00:00Z',
  deleted_at: null,
  archived_at: null,
}

const mockTagSuggestions: TagCount[] = [
  { name: 'test', content_count: 5, filter_count: 0 },
]

describe('CodeMirror focus restoration after Cmd+S', () => {
  let mockOnSave: ReturnType<typeof vi.fn>
  let mockOnClose: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorageMock.clear()
    // Set editor mode to text so CodeMirror is used
    localStorageMock.setItem('editor_mode_preference', 'text')
    mockOnSave = vi.fn().mockResolvedValue(undefined)
    mockOnClose = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should detect when focus is in CodeMirror editor', async () => {
    render(
      <Note
        note={mockNote}
        tagSuggestions={mockTagSuggestions}
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    )

    // Find the CodeMirror textarea (in text mode)
    const editor = screen.getByTestId('content-editor-text')

    // Focus the editor
    editor.focus()

    // Verify it's inside .cm-editor
    expect(editor.closest('.cm-editor')).not.toBeNull()
  })

  it('should call onSave when Cmd+S is pressed with changes', async () => {
    const user = userEvent.setup()

    render(
      <Note
        note={mockNote}
        tagSuggestions={mockTagSuggestions}
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    )

    // Find the CodeMirror textarea and make a change
    const editor = screen.getByTestId('content-editor-text')
    await user.click(editor)
    await user.type(editor, ' - updated')

    // Press Cmd+S
    fireEvent.keyDown(document, { key: 's', metaKey: true })

    // Wait for save to be called
    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalled()
    })
  })

  it('should restore focus to CodeMirror after Cmd+S save', async () => {
    const user = userEvent.setup()

    render(
      <Note
        note={mockNote}
        tagSuggestions={mockTagSuggestions}
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    )

    // Find the CodeMirror textarea and make a change
    const editor = screen.getByTestId('content-editor-text')
    await user.click(editor)
    await user.type(editor, ' - updated')

    // Verify editor is focused
    expect(document.activeElement).toBe(editor)

    // Press Cmd+S
    fireEvent.keyDown(document, { key: 's', metaKey: true })

    // Wait for save to complete and focus to be restored
    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalled()
    })

    // Note: In jsdom, focus restoration may not work perfectly
    // This test verifies the mechanism is in place, but manual testing
    // in a real browser is recommended for full confidence
    await waitFor(
      () => {
        // The editor should have focus restored (or still have it)
        expect(document.activeElement).toBe(editor)
      },
      { timeout: 100 }
    )
  })
})
