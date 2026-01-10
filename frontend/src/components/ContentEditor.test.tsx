/**
 * Tests for ContentEditor component.
 *
 * Tests the mode toggle between Visual (Milkdown) and Markdown (CodeMirror) modes,
 * localStorage persistence, and wrap text toggle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContentEditor } from './ContentEditor'

// Mock MilkdownEditor since it has complex ProseMirror interactions
vi.mock('./MilkdownEditor', () => ({
  MilkdownEditor: ({ value, onChange, placeholder, disabled }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
  }) => (
    <div data-testid="milkdown-mock" data-disabled={disabled}>
      <textarea
        data-testid="milkdown-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  ),
}))

// Mock CodeMirrorEditor since it has complex CodeMirror interactions
vi.mock('./CodeMirrorEditor', () => ({
  CodeMirrorEditor: ({ value, onChange, placeholder, disabled, wrapText }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
    wrapText?: boolean
  }) => (
    <div data-testid="codemirror-mock" data-disabled={disabled} data-wrap={wrapText}>
      <textarea
        data-testid="codemirror-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  ),
}))

// Mock localStorage with proper reset
let localStorageStore: Record<string, string> = {}

const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key]
  }),
  clear: vi.fn(() => {
    localStorageStore = {}
  }),
}

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('ContentEditor', () => {
  const defaultProps = {
    value: 'Test content',
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageStore = {}  // Reset the store
    // Reset mock implementations to default behavior
    localStorageMock.getItem.mockImplementation((key: string) => localStorageStore[key] ?? null)
  })

  describe('mode toggle', () => {
    it('should render Visual mode by default when no preference is stored', () => {
      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByTestId('milkdown-mock')).toBeInTheDocument()
      expect(screen.queryByTestId('codemirror-mock')).not.toBeInTheDocument()
    })

    it('should render Markdown mode when preference is stored', () => {
      localStorageStore['editor_mode_preference'] = 'markdown'

      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByTestId('codemirror-mock')).toBeInTheDocument()
      expect(screen.queryByTestId('milkdown-mock')).not.toBeInTheDocument()
    })

    it('should switch to Markdown mode when Markdown button is clicked', async () => {
      const user = userEvent.setup()

      render(<ContentEditor {...defaultProps} />)

      // First focus the editor so the toolbar becomes active
      await user.click(screen.getByTestId('milkdown-textarea'))
      await user.click(screen.getByRole('button', { name: 'Markdown' }))

      expect(screen.getByTestId('codemirror-mock')).toBeInTheDocument()
      expect(screen.queryByTestId('milkdown-mock')).not.toBeInTheDocument()
    })

    it('should switch to Visual mode when Visual button is clicked', async () => {
      localStorageStore['editor_mode_preference'] = 'markdown'
      const user = userEvent.setup()

      render(<ContentEditor {...defaultProps} />)

      // First focus the editor so the toolbar becomes active
      await user.click(screen.getByTestId('codemirror-textarea'))
      await user.click(screen.getByRole('button', { name: 'Visual' }))

      expect(screen.getByTestId('milkdown-mock')).toBeInTheDocument()
      expect(screen.queryByTestId('codemirror-mock')).not.toBeInTheDocument()
    })

    it('should persist mode preference to localStorage', async () => {
      const user = userEvent.setup()

      render(<ContentEditor {...defaultProps} />)

      // First focus the editor so the toolbar becomes active
      await user.click(screen.getByTestId('milkdown-textarea'))
      await user.click(screen.getByRole('button', { name: 'Markdown' }))

      expect(localStorageMock.setItem).toHaveBeenCalledWith('editor_mode_preference', 'markdown')
    })

    it('should highlight the active mode button', async () => {
      const user = userEvent.setup()

      render(<ContentEditor {...defaultProps} />)

      const visualButton = screen.getByRole('button', { name: 'Visual' })
      const markdownButton = screen.getByRole('button', { name: 'Markdown' })

      // Visual should be active initially (bg-white indicates selected in pill toggle)
      expect(visualButton).toHaveClass('bg-white')
      expect(markdownButton).not.toHaveClass('bg-white')

      // First focus the editor so the toolbar becomes active, then switch to Markdown
      await user.click(screen.getByTestId('milkdown-textarea'))
      await user.click(markdownButton)

      expect(markdownButton).toHaveClass('bg-white')
      expect(visualButton).not.toHaveClass('bg-white')
    })
  })

  describe('wrap text toggle', () => {
    it('should not show wrap checkbox in Visual mode', () => {
      render(<ContentEditor {...defaultProps} />)

      expect(screen.queryByLabelText('Wrap')).not.toBeInTheDocument()
    })

    it('should show wrap checkbox in Markdown mode', async () => {
      localStorageStore['editor_mode_preference'] = 'markdown'

      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByLabelText('Wrap')).toBeInTheDocument()
    })

    it('should default to wrapped text', async () => {
      localStorageStore['editor_mode_preference'] = 'markdown'

      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByLabelText('Wrap')).toBeChecked()
    })

    it('should persist wrap preference to localStorage', async () => {
      localStorageStore['editor_mode_preference'] = 'markdown'
      localStorageStore['editor_wrap_text'] = 'true'
      const user = userEvent.setup()

      render(<ContentEditor {...defaultProps} />)

      await user.click(screen.getByLabelText('Wrap'))

      expect(localStorageMock.setItem).toHaveBeenCalledWith('editor_wrap_text', 'false')
    })

    it('should pass wrapText prop to CodeMirrorEditor', async () => {
      localStorageStore['editor_mode_preference'] = 'markdown'
      localStorageStore['editor_wrap_text'] = 'true'

      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByTestId('codemirror-mock')).toHaveAttribute('data-wrap', 'true')
    })
  })

  describe('value and onChange', () => {
    it('should pass value to the active editor', () => {
      render(<ContentEditor {...defaultProps} value="Hello World" />)

      expect(screen.getByTestId('milkdown-textarea')).toHaveValue('Hello World')
    })

    it('should call onChange when editor content changes', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<ContentEditor {...defaultProps} onChange={onChange} value="" />)

      await user.type(screen.getByTestId('milkdown-textarea'), 'New content')

      expect(onChange).toHaveBeenCalled()
    })

    it('should preserve value when switching modes', async () => {
      const user = userEvent.setup()

      render(<ContentEditor {...defaultProps} value="Preserved content" />)

      // First focus the editor, then switch to Markdown mode
      await user.click(screen.getByTestId('milkdown-textarea'))
      await user.click(screen.getByRole('button', { name: 'Markdown' }))

      expect(screen.getByTestId('codemirror-textarea')).toHaveValue('Preserved content')
    })
  })

  describe('helper text and error messages', () => {
    it('should show default helper text for Visual mode', () => {
      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByText(/keyboard shortcuts/)).toBeInTheDocument()
    })

    it('should show default helper text for Markdown mode', async () => {
      localStorageStore['editor_mode_preference'] = 'markdown'

      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByText(/Markdown mode/)).toBeInTheDocument()
    })

    it('should show custom helper text when provided', () => {
      render(<ContentEditor {...defaultProps} helperText="Custom helper" />)

      expect(screen.getByText('Custom helper')).toBeInTheDocument()
    })

    it('should show error message instead of helper text when provided', () => {
      render(
        <ContentEditor
          {...defaultProps}
          helperText="Helper"
          errorMessage="Error message"
        />
      )

      expect(screen.getByText('Error message')).toBeInTheDocument()
      expect(screen.queryByText('Helper')).not.toBeInTheDocument()
    })

    it('should apply error styling when hasError is true', () => {
      render(<ContentEditor {...defaultProps} hasError={true} />)

      const container = screen.getByTestId('milkdown-mock').parentElement
      expect(container).toHaveClass('border-red-300')
    })
  })

  describe('character counter', () => {
    it('should show character counter when maxLength is provided', () => {
      render(<ContentEditor {...defaultProps} value="Hello" maxLength={1000} />)

      expect(screen.getByText('5/1,000')).toBeInTheDocument()
    })

    it('should not show character counter when maxLength is not provided', () => {
      render(<ContentEditor {...defaultProps} value="Hello" />)

      expect(screen.queryByText(/\/1,000/)).not.toBeInTheDocument()
    })
  })

  describe('label', () => {
    it('should show default label', () => {
      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByText('Content')).toBeInTheDocument()
    })

    it('should show custom label when provided', () => {
      render(<ContentEditor {...defaultProps} label="Custom Label" />)

      expect(screen.getByText('Custom Label')).toBeInTheDocument()
    })
  })

  describe('disabled state', () => {
    it('should pass disabled prop to the editor', () => {
      render(<ContentEditor {...defaultProps} disabled={true} />)

      expect(screen.getByTestId('milkdown-mock')).toHaveAttribute('data-disabled', 'true')
    })
  })

  describe('toolbar focus behavior', () => {
    it('should NOT switch modes when clicking mode toggle without editor focus', async () => {
      const user = userEvent.setup()

      render(<ContentEditor {...defaultProps} />)

      // Click mode toggle directly without focusing editor first
      // The first click should reveal the toolbar but NOT switch modes
      await user.click(screen.getByRole('button', { name: 'Markdown' }))

      // Should still be in Visual mode (milkdown)
      expect(screen.getByTestId('milkdown-mock')).toBeInTheDocument()
      expect(screen.queryByTestId('codemirror-mock')).not.toBeInTheDocument()
    })

    it('should switch modes when clicking mode toggle with editor already focused', async () => {
      const user = userEvent.setup()

      render(<ContentEditor {...defaultProps} />)

      // First focus the editor
      await user.click(screen.getByTestId('milkdown-textarea'))
      // Then click mode toggle - should switch modes
      await user.click(screen.getByRole('button', { name: 'Markdown' }))

      expect(screen.getByTestId('codemirror-mock')).toBeInTheDocument()
      expect(screen.queryByTestId('milkdown-mock')).not.toBeInTheDocument()
    })

    it('should require two clicks to switch modes when starting unfocused', async () => {
      const user = userEvent.setup()

      render(<ContentEditor {...defaultProps} />)

      // First click - reveals toolbar, focuses editor
      await user.click(screen.getByRole('button', { name: 'Markdown' }))
      // Should still be Visual mode
      expect(screen.getByTestId('milkdown-mock')).toBeInTheDocument()

      // Second click - now editor is focused, should switch
      await user.click(screen.getByRole('button', { name: 'Markdown' }))
      // Now should be Markdown mode
      expect(screen.getByTestId('codemirror-mock')).toBeInTheDocument()
    })
  })
})
