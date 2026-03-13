/**
 * Tests for InlineEditableTitle component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InlineEditableTitle } from './InlineEditableTitle'

describe('InlineEditableTitle', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia
  })

  describe('rendering', () => {
    it('should render an input with the value', () => {
      render(<InlineEditableTitle value="Test Title" onChange={vi.fn()} />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('Test Title')
    })

    it('should show placeholder when value is empty', () => {
      render(<InlineEditableTitle value="" onChange={vi.fn()} placeholder="Enter title" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder', 'Enter title')
    })

    it('should use default placeholder when not specified', () => {
      render(<InlineEditableTitle value="" onChange={vi.fn()} />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder', 'Title')
    })
  })

  describe('variants', () => {
    it('should apply title variant styling by default', () => {
      render(<InlineEditableTitle value="Title" onChange={vi.fn()} />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('text-2xl')
      expect(input.className).toContain('font-bold')
    })

    it('should apply name variant styling with monospace', () => {
      render(<InlineEditableTitle value="name" onChange={vi.fn()} variant="name" />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('font-mono')
      expect(input.className).toContain('text-lg')
    })
  })

  describe('onChange', () => {
    it('should call onChange when value changes', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      render(<InlineEditableTitle value="" onChange={mockOnChange} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'a')

      expect(mockOnChange).toHaveBeenCalledWith('a')
    })

    it('should call onChange for each keystroke', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      render(<InlineEditableTitle value="" onChange={mockOnChange} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'abc')

      expect(mockOnChange).toHaveBeenCalledTimes(3)
    })
  })

  describe('onEnter', () => {
    it('should call onEnter when Enter is pressed', async () => {
      const user = userEvent.setup()
      const mockOnEnter = vi.fn()
      render(<InlineEditableTitle value="Title" onChange={vi.fn()} onEnter={mockOnEnter} />)

      const input = screen.getByRole('textbox')
      await user.type(input, '{Enter}')

      expect(mockOnEnter).toHaveBeenCalled()
    })

    it('should not call onEnter if not provided', async () => {
      const user = userEvent.setup()
      render(<InlineEditableTitle value="Title" onChange={vi.fn()} />)

      const input = screen.getByRole('textbox')
      // Should not throw
      await user.type(input, '{Enter}')
    })
  })

  describe('disabled state', () => {
    it('should disable the input when disabled is true', () => {
      render(<InlineEditableTitle value="Title" onChange={vi.fn()} disabled />)

      const input = screen.getByRole('textbox')
      expect(input).toBeDisabled()
    })

    it('should apply disabled styling', () => {
      render(<InlineEditableTitle value="Title" onChange={vi.fn()} disabled />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('cursor-not-allowed')
      expect(input.className).toContain('opacity-60')
    })
  })

  describe('required state', () => {
    it('should set required attribute when required is true', () => {
      render(<InlineEditableTitle value="Title" onChange={vi.fn()} required />)

      const input = screen.getByRole('textbox')
      expect(input).toBeRequired()
    })

    it('should set aria-required attribute', () => {
      render(<InlineEditableTitle value="Title" onChange={vi.fn()} required />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('aria-required', 'true')
    })
  })

  describe('error state', () => {
    it('should display error message', () => {
      render(<InlineEditableTitle value="" onChange={vi.fn()} error="Title is required" />)

      expect(screen.getByText('Title is required')).toBeInTheDocument()
    })

    it('should apply error styling to input', () => {
      render(<InlineEditableTitle value="" onChange={vi.fn()} error="Error" />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('ring-red-200')
    })

    it('should set aria-invalid when error is present', () => {
      render(<InlineEditableTitle value="" onChange={vi.fn()} error="Error" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('aria-invalid', 'true')
    })

    it('should link error message with aria-describedby', () => {
      render(<InlineEditableTitle value="" onChange={vi.fn()} error="Error message" />)

      const input = screen.getByRole('textbox')
      const errorId = input.getAttribute('aria-describedby')
      expect(errorId).toBeTruthy()

      const errorElement = document.getElementById(errorId!)
      expect(errorElement).toHaveTextContent('Error message')
    })
  })

  describe('progressive character limit', () => {
    it('should not set maxLength attribute on input', () => {
      render(<InlineEditableTitle value="" onChange={vi.fn()} maxLength={10} />)

      const input = screen.getByRole('textbox')
      expect(input).not.toHaveAttribute('maxLength')
    })

    it('should allow typing beyond the limit', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      render(<InlineEditableTitle value="12345" onChange={mockOnChange} maxLength={5} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'x')

      expect(mockOnChange).toHaveBeenCalled()
    })

    it('should not show feedback below 70% of max', () => {
      render(<InlineEditableTitle value="123" onChange={vi.fn()} maxLength={10} />)

      const feedback = screen.getByTestId('character-limit-feedback')
      expect(feedback.style.visibility).toBe('hidden')
    })

    it('should show counter at 70% of max', () => {
      render(<InlineEditableTitle value="1234567" onChange={vi.fn()} maxLength={10} />)

      const feedback = screen.getByTestId('character-limit-feedback')
      expect(feedback.style.visibility).toBe('visible')
      expect(screen.getByText('7 / 10')).toBeInTheDocument()
    })

    it('should show "Character limit reached" at exactly 100%', () => {
      render(<InlineEditableTitle value="1234567890" onChange={vi.fn()} maxLength={10} />)

      expect(screen.getByText('Character limit reached')).toBeInTheDocument()
      expect(screen.getByText('10 / 10')).toBeInTheDocument()
    })

    it('should not show red border at exactly 100%', () => {
      render(<InlineEditableTitle value="1234567890" onChange={vi.fn()} maxLength={10} />)

      const input = screen.getByRole('textbox')
      expect(input.className).not.toContain('ring-red-200')
    })

    it('should show exceeded message above 100%', () => {
      render(<InlineEditableTitle value="12345678901" onChange={vi.fn()} maxLength={10} />)

      expect(screen.getByText('Character limit exceeded - saving is disabled')).toBeInTheDocument()
      expect(screen.getByText('11 / 10')).toBeInTheDocument()
    })

    it('should show red border when exceeded (> 100%)', () => {
      render(<InlineEditableTitle value="12345678901" onChange={vi.fn()} maxLength={10} />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('ring-red-200')
    })

    it('should not set aria-invalid for limit feedback', () => {
      render(<InlineEditableTitle value="1234567890" onChange={vi.fn()} maxLength={10} />)

      const input = screen.getByRole('textbox')
      expect(input).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('should set aria-invalid only when parent error is present', () => {
      render(<InlineEditableTitle value="12345678901" onChange={vi.fn()} maxLength={10} error="Error" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('aria-invalid', 'true')
    })

    it('should show parent error alongside limit feedback', () => {
      render(
        <InlineEditableTitle value="12345678901" onChange={vi.fn()} maxLength={10} error="Name format invalid" />
      )

      expect(screen.getByText('Name format invalid')).toBeInTheDocument()
      expect(screen.getByText('Character limit exceeded - saving is disabled')).toBeInTheDocument()
    })
  })

  describe('custom className', () => {
    it('should apply custom className', () => {
      render(<InlineEditableTitle value="Title" onChange={vi.fn()} className="custom-class" />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('custom-class')
    })
  })

  describe('focus behavior', () => {
    it('should be focusable', () => {
      render(<InlineEditableTitle value="Title" onChange={vi.fn()} />)

      const input = screen.getByRole('textbox')
      input.focus()
      expect(document.activeElement).toBe(input)
    })
  })
})
