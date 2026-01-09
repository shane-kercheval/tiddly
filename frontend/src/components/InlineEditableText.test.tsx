/**
 * Tests for InlineEditableText component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InlineEditableText } from './InlineEditableText'

describe('InlineEditableText', () => {
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

  describe('maxLength', () => {
    it('should set maxLength attribute', () => {
      render(<InlineEditableText value="" onChange={vi.fn()} maxLength={100} />)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveAttribute('maxLength', '100')
    })

    it('should not allow input beyond maxLength', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      render(<InlineEditableText value="12345" onChange={mockOnChange} maxLength={5} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'x')

      // onChange should not have been called because we're at max
      expect(mockOnChange).not.toHaveBeenCalled()
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
