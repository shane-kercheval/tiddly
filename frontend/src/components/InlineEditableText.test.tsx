/**
 * Tests for InlineEditableText component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InlineEditableText } from './InlineEditableText'

describe('InlineEditableText', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia
  })

  describe('rendering', () => {
    it('should render a textarea with the value', () => {
      render(<InlineEditableText value="Test description" onChange={vi.fn()} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('Test description')
    })

    it('should show placeholder when value is empty', () => {
      render(<InlineEditableText value="" onChange={vi.fn()} placeholder="Enter description" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('placeholder', 'Enter description')
    })

    it('should use default placeholder when not specified', () => {
      render(<InlineEditableText value="" onChange={vi.fn()} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('placeholder', 'Add a description...')
    })
  })

  describe('variants', () => {
    it('should apply description variant styling by default', () => {
      render(<InlineEditableText value="Description" onChange={vi.fn()} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('text-gray-600')
      expect(textarea.className).toContain('italic')
    })

    it('should apply body variant styling', () => {
      render(<InlineEditableText value="Body text" onChange={vi.fn()} variant="body" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('text-gray-900')
      expect(textarea.className).not.toContain('italic')
    })
  })

  describe('onChange', () => {
    it('should call onChange when value changes', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      render(<InlineEditableText value="" onChange={mockOnChange} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'a')

      expect(mockOnChange).toHaveBeenCalledWith('a')
    })

    it('should call onChange for each keystroke', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      render(<InlineEditableText value="" onChange={mockOnChange} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'abc')

      expect(mockOnChange).toHaveBeenCalledTimes(3)
    })
  })

  describe('progressive character limit', () => {
    it('should not set maxLength attribute', () => {
      render(<InlineEditableText value="" onChange={vi.fn()} maxLength={100} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).not.toHaveAttribute('maxLength')
    })

    it('should allow input beyond maxLength', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      render(<InlineEditableText value="12345" onChange={mockOnChange} maxLength={5} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'x')

      expect(mockOnChange).toHaveBeenCalled()
    })

    it('should show "Character limit reached" at exactly 100%', () => {
      render(<InlineEditableText value="12345" onChange={vi.fn()} maxLength={5} />)

      expect(screen.getByText('Character limit reached')).toBeInTheDocument()
    })

    it('should show exceeded message above 100%', () => {
      render(<InlineEditableText value="123456" onChange={vi.fn()} maxLength={5} />)

      expect(screen.getByText('Character limit exceeded - saving is disabled')).toBeInTheDocument()
    })

    it('should show red border only when exceeded (> 100%)', () => {
      // At exactly 100% - no red border
      const { unmount } = render(<InlineEditableText value="12345" onChange={vi.fn()} maxLength={5} />)
      let textarea = screen.getByRole('textbox')
      expect(textarea.className).not.toContain('ring-red-200')
      unmount()

      // Above 100% - red border
      render(<InlineEditableText value="123456" onChange={vi.fn()} maxLength={5} />)
      textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('ring-red-200')
    })

    it('should not show limit message when under 70%', () => {
      render(<InlineEditableText value="12" onChange={vi.fn()} maxLength={10} />)

      const feedback = screen.getByTestId('character-limit-feedback')
      expect(feedback.style.visibility).toBe('hidden')
    })

    it('should show counter at 70%+ of max', () => {
      render(<InlineEditableText value="1234567" onChange={vi.fn()} maxLength={10} />)

      expect(screen.getByText('7 / 10')).toBeInTheDocument()
    })

    it('should show parent error alongside limit feedback', () => {
      render(
        <InlineEditableText value="123456" onChange={vi.fn()} maxLength={5} error="Description too long" />
      )

      expect(screen.getByText('Description too long')).toBeInTheDocument()
      expect(screen.getByText('Character limit exceeded - saving is disabled')).toBeInTheDocument()
    })

    it('should not set aria-invalid for limit reached without parent error', () => {
      render(<InlineEditableText value="12345" onChange={vi.fn()} maxLength={5} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('should set aria-invalid only when parent error is present', () => {
      render(<InlineEditableText value="12345" onChange={vi.fn()} maxLength={5} error="Error" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('aria-invalid', 'true')
    })
  })

  describe('disabled state', () => {
    it('should disable the textarea when disabled is true', () => {
      render(<InlineEditableText value="Text" onChange={vi.fn()} disabled />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toBeDisabled()
    })

    it('should apply disabled styling', () => {
      render(<InlineEditableText value="Text" onChange={vi.fn()} disabled />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('cursor-not-allowed')
      expect(textarea.className).toContain('opacity-60')
    })
  })

  describe('error state', () => {
    it('should display error message', () => {
      render(<InlineEditableText value="" onChange={vi.fn()} error="Description is required" />)

      expect(screen.getByText('Description is required')).toBeInTheDocument()
    })

    it('should apply error styling to textarea', () => {
      render(<InlineEditableText value="" onChange={vi.fn()} error="Error" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('ring-red-200')
    })

    it('should set aria-invalid when error is present', () => {
      render(<InlineEditableText value="" onChange={vi.fn()} error="Error" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('aria-invalid', 'true')
    })

    it('should link error message with aria-describedby', () => {
      render(<InlineEditableText value="" onChange={vi.fn()} error="Error message" />)

      const textarea = screen.getByRole('textbox')
      const errorId = textarea.getAttribute('aria-describedby')
      expect(errorId).toBeTruthy()

      const errorElement = document.getElementById(errorId!)
      expect(errorElement).toHaveTextContent('Error message')
    })
  })

  describe('multiline', () => {
    it('should start with one row', () => {
      render(<InlineEditableText value="" onChange={vi.fn()} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('rows', '1')
    })

    it('should not be resizable via CSS', () => {
      render(<InlineEditableText value="Text" onChange={vi.fn()} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('resize-none')
    })
  })

  describe('custom className', () => {
    it('should apply custom className', () => {
      render(<InlineEditableText value="Text" onChange={vi.fn()} className="custom-class" />)

      const textarea = screen.getByRole('textbox')
      expect(textarea.className).toContain('custom-class')
    })
  })

  describe('focus behavior', () => {
    it('should be focusable', () => {
      render(<InlineEditableText value="Text" onChange={vi.fn()} />)

      const textarea = screen.getByRole('textbox')
      textarea.focus()
      expect(document.activeElement).toBe(textarea)
    })
  })
})
