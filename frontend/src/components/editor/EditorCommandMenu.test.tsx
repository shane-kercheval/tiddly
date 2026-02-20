/**
 * Tests for EditorCommandMenu component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { EditorCommandMenu } from './EditorCommandMenu'
import type { EditorCommand } from './editorCommands'

function makeCommand(overrides: Partial<EditorCommand> = {}): EditorCommand {
  return {
    id: 'test-cmd',
    label: 'Test Command',
    section: 'Format',
    icon: createElement('span', null, 'icon'),
    action: vi.fn(),
    ...overrides,
  }
}

const sampleCommands: EditorCommand[] = [
  makeCommand({ id: 'bold', label: 'Bold', section: 'Format', shortcut: ['\u2318', 'B'] }),
  makeCommand({ id: 'italic', label: 'Italic', section: 'Format' }),
  makeCommand({ id: 'heading-1', label: 'Heading 1', section: 'Insert' }),
  makeCommand({ id: 'save', label: 'Save', section: 'Actions' }),
]

describe('EditorCommandMenu', () => {
  let onClose: ReturnType<typeof vi.fn>
  let onExecute: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onClose = vi.fn()
    onExecute = vi.fn()
  })

  it('should render the listbox when mounted', () => {
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('should display all commands grouped by section', () => {
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    expect(screen.getByText('Bold')).toBeInTheDocument()
    expect(screen.getByText('Italic')).toBeInTheDocument()
    expect(screen.getByText('Heading 1')).toBeInTheDocument()
    expect(screen.getByText('Save')).toBeInTheDocument()

    // Section headers
    expect(screen.getByText('Format')).toBeInTheDocument()
    expect(screen.getByText('Insert')).toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
  })

  it('should filter commands by typing in the input', async () => {
    const user = userEvent.setup()
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    const input = screen.getByPlaceholderText('Type a command...')
    await user.type(input, 'bold')

    expect(screen.getByText('Bold')).toBeInTheDocument()
    expect(screen.queryByText('Italic')).not.toBeInTheDocument()
    expect(screen.queryByText('Heading 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Save')).not.toBeInTheDocument()
  })

  it('should show no matches message when filter has no results', async () => {
    const user = userEvent.setup()
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    const input = screen.getByPlaceholderText('Type a command...')
    await user.type(input, 'nonexistent')

    expect(screen.getByText('No matching commands')).toBeInTheDocument()
  })

  it('should call onExecute when Enter is pressed', async () => {
    const user = userEvent.setup()
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    const input = screen.getByPlaceholderText('Type a command...')
    await user.click(input)
    await user.keyboard('{Enter}')

    // First command should be executed (Bold)
    expect(onExecute).toHaveBeenCalledWith(sampleCommands[0])
    expect(input).toBeInTheDocument() // just checking the input was there
  })

  it('should navigate with arrow keys', async () => {
    const user = userEvent.setup()
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    // Focus the input, arrow down then Enter should select second item (Italic)
    const input = screen.getByPlaceholderText('Type a command...')
    await user.click(input)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onExecute).toHaveBeenCalledWith(sampleCommands[1])
  })

  it('should wrap around when navigating past last item', async () => {
    const user = userEvent.setup()
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    const input = screen.getByPlaceholderText('Type a command...')
    await user.click(input)
    // Press down 4 times (past the last of 4 items) should wrap to first
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
    expect(onExecute).toHaveBeenCalledWith(sampleCommands[0])
  })

  it('should wrap around when navigating up past first item', async () => {
    const user = userEvent.setup()
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    const input = screen.getByPlaceholderText('Type a command...')
    await user.click(input)
    // Press up from first item should wrap to last
    await user.keyboard('{ArrowUp}{Enter}')
    expect(onExecute).toHaveBeenCalledWith(sampleCommands[3])
  })

  it('should close on Escape', async () => {
    const user = userEvent.setup()
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    const input = screen.getByPlaceholderText('Type a command...')
    await user.click(input)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('should execute command on click', async () => {
    const user = userEvent.setup()
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    await user.click(screen.getByText('Heading 1'))
    expect(onExecute).toHaveBeenCalledWith(sampleCommands[2])
  })

  it('should display keyboard shortcut badges', () => {
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    // Bold has shortcut ['\u2318', 'B']
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('should filter case-insensitively', async () => {
    const user = userEvent.setup()
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    const input = screen.getByPlaceholderText('Type a command...')
    await user.type(input, 'BOLD')

    expect(screen.getByText('Bold')).toBeInTheDocument()
    expect(screen.queryByText('Italic')).not.toBeInTheDocument()
  })

  it('should show section dividers between groups', () => {
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    // There are 3 sections, so 2 dividers between them
    const listbox = screen.getByRole('listbox')
    const dividers = listbox.querySelectorAll('.border-t')
    expect(dividers.length).toBe(2)
  })

  it('should close on Escape via document-level handler (even without input focus)', () => {
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    // Dispatch Escape directly on document (not through the input)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('should apply blue styling to keyboard-selected item', () => {
    render(
      <EditorCommandMenu
        onClose={onClose}
        onExecute={onExecute}
        commands={sampleCommands}
        anchorCoords={null}
      />
    )

    // First item is selected by default
    const selectedOption = screen.getByRole('option', { selected: true })
    expect(selectedOption.className).toContain('bg-blue-50')
    expect(selectedOption.className).toContain('text-blue-700')
  })
})
