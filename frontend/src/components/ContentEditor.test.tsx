/**
 * Tests for ContentEditor component.
 *
 * ContentEditor now always uses CodeMirrorEditor (with optional Reading mode
 * handled inside CodeMirrorEditor). Tests wrap text preference persistence
 * and basic editor functionality.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContentEditor } from './ContentEditor'

// Mock CodeMirrorEditor since it has complex CodeMirror interactions
vi.mock('./CodeMirrorEditor', () => ({
  CodeMirrorEditor: ({ value, onChange, placeholder, disabled, wrapText, monoFont, onMonoFontChange }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
    wrapText?: boolean
    monoFont?: boolean
    onMonoFontChange?: (mono: boolean) => void
  }) => (
    <div data-testid="codemirror-mock" data-disabled={disabled} data-wrap={wrapText} data-mono-font={monoFont}>
      <textarea
        data-testid="codemirror-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {onMonoFontChange && (
        <button data-testid="toggle-mono" onClick={() => onMonoFontChange(!monoFont)}>Toggle Mono</button>
      )}
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
    localStorageStore = {}
    localStorageMock.getItem.mockImplementation((key: string) => localStorageStore[key] ?? null)
  })

  describe('editor rendering', () => {
    it('should always render CodeMirrorEditor', () => {
      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByTestId('codemirror-mock')).toBeInTheDocument()
    })

    it('should pass value to editor', () => {
      render(<ContentEditor {...defaultProps} value="Hello World" />)

      expect(screen.getByTestId('codemirror-textarea')).toHaveValue('Hello World')
    })

    it('should call onChange when editor content changes', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<ContentEditor {...defaultProps} onChange={onChange} value="" />)

      await user.type(screen.getByTestId('codemirror-textarea'), 'New content')

      expect(onChange).toHaveBeenCalled()
    })
  })

  describe('wrap text preference', () => {
    it('should default to wrapped text', () => {
      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByTestId('codemirror-mock')).toHaveAttribute('data-wrap', 'true')
    })

    it('should load wrap preference from localStorage', () => {
      localStorageStore['editor_wrap_text'] = 'false'

      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByTestId('codemirror-mock')).toHaveAttribute('data-wrap', 'false')
    })

    it('should pass wrapText prop to CodeMirrorEditor', () => {
      localStorageStore['editor_wrap_text'] = 'true'

      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByTestId('codemirror-mock')).toHaveAttribute('data-wrap', 'true')
    })
  })

  describe('mono font preference', () => {
    it('should default to non-mono font (Inter)', () => {
      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByTestId('codemirror-mock')).toHaveAttribute('data-mono-font', 'false')
    })

    it('should load mono font preference from localStorage', () => {
      localStorageStore['editor_mono_font'] = 'true'

      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByTestId('codemirror-mock')).toHaveAttribute('data-mono-font', 'true')
    })

    it('should default to false when localStorage has no value', () => {
      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByTestId('codemirror-mock')).toHaveAttribute('data-mono-font', 'false')
    })

    it('should persist mono font preference to localStorage on toggle', async () => {
      const user = userEvent.setup()

      render(<ContentEditor {...defaultProps} />)

      await user.click(screen.getByTestId('toggle-mono'))

      expect(localStorageMock.setItem).toHaveBeenCalledWith('editor_mono_font', 'true')
      expect(screen.getByTestId('codemirror-mock')).toHaveAttribute('data-mono-font', 'true')
    })
  })

  describe('helper text and error messages', () => {
    it('should not show helper text when none provided', () => {
      render(<ContentEditor {...defaultProps} />)

      const footer = document.querySelector('.flex.justify-between.items-center.mt-1')
      expect(footer?.querySelector('.helper-text')).not.toBeInTheDocument()
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

      const container = screen.getByTestId('codemirror-mock').parentElement
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

      expect(screen.getByTestId('codemirror-mock')).toHaveAttribute('data-disabled', 'true')
    })
  })

  describe('placeholder', () => {
    it('should pass placeholder to CodeMirrorEditor', () => {
      render(<ContentEditor {...defaultProps} placeholder="Custom placeholder" />)

      expect(screen.getByTestId('codemirror-textarea')).toHaveAttribute('placeholder', 'Custom placeholder')
    })

    it('should use default placeholder when not provided', () => {
      render(<ContentEditor {...defaultProps} />)

      expect(screen.getByTestId('codemirror-textarea')).toHaveAttribute('placeholder', 'Write your content in markdown...')
    })
  })
})
