/**
 * Tests for InlineEditableUrl component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InlineEditableUrl } from './InlineEditableUrl'

describe('InlineEditableUrl', () => {
  describe('rendering', () => {
    it('should render an input with the value', () => {
      render(<InlineEditableUrl value="https://example.com" onChange={vi.fn()} />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('https://example.com')
    })

    it('should show placeholder when value is empty', () => {
      render(<InlineEditableUrl value="" onChange={vi.fn()} placeholder="Enter URL" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder', 'Enter URL')
    })

    it('should use default placeholder when not specified', () => {
      render(<InlineEditableUrl value="" onChange={vi.fn()} />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder', 'https://example.com')
    })
  })

  describe('onChange', () => {
    it('should call onChange when value changes', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      render(<InlineEditableUrl value="" onChange={mockOnChange} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'a')

      expect(mockOnChange).toHaveBeenCalledWith('a')
    })
  })

  describe('maxLength', () => {
    it('should set maxLength attribute on input', () => {
      render(<InlineEditableUrl value="" onChange={vi.fn()} maxLength={100} />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('maxLength', '100')
    })

    it('should not call onChange when input exceeds maxLength', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      render(<InlineEditableUrl value="12345" onChange={mockOnChange} maxLength={5} />)

      const input = screen.getByRole('textbox')
      await user.type(input, 'x')

      expect(mockOnChange).not.toHaveBeenCalled()
    })
  })

  describe('character limit feedback', () => {
    it('should show "Character limit reached" with limit when value is at maxLength', () => {
      render(<InlineEditableUrl value="12345" onChange={vi.fn()} maxLength={5} />)

      expect(screen.getByText('Character limit reached (5)')).toBeInTheDocument()
    })

    it('should show red border when at maxLength', () => {
      render(<InlineEditableUrl value="12345" onChange={vi.fn()} maxLength={5} />)

      const input = screen.getByRole('textbox')
      const container = input.closest('.flex.items-center')
      expect(container?.className).toContain('ring-red-200')
    })

    it('should not show limit message when under maxLength', () => {
      render(<InlineEditableUrl value="1234" onChange={vi.fn()} maxLength={5} />)

      expect(screen.queryByText(/Character limit reached/)).not.toBeInTheDocument()
    })

    it('should show parent error instead of limit message when both apply', () => {
      render(
        <InlineEditableUrl value="12345" onChange={vi.fn()} maxLength={5} error="Invalid URL" />
      )

      expect(screen.getByText('Invalid URL')).toBeInTheDocument()
      expect(screen.queryByText(/Character limit reached/)).not.toBeInTheDocument()
    })

    it('should not set aria-invalid for limit reached without parent error', () => {
      render(<InlineEditableUrl value="12345" onChange={vi.fn()} maxLength={5} />)

      const input = screen.getByRole('textbox')
      expect(input).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('should set aria-invalid only when parent error is present', () => {
      render(<InlineEditableUrl value="12345" onChange={vi.fn()} maxLength={5} error="Error" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('aria-invalid', 'true')
    })
  })

  describe('error state', () => {
    it('should display error message', () => {
      render(<InlineEditableUrl value="" onChange={vi.fn()} error="URL is required" />)

      expect(screen.getByText('URL is required')).toBeInTheDocument()
    })

    it('should set aria-invalid when error is present', () => {
      render(<InlineEditableUrl value="" onChange={vi.fn()} error="Error" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('aria-invalid', 'true')
    })

    it('should link error message with aria-describedby', () => {
      render(<InlineEditableUrl value="" onChange={vi.fn()} error="Error message" />)

      const input = screen.getByRole('textbox')
      const errorId = input.getAttribute('aria-describedby')
      expect(errorId).toBeTruthy()

      const errorElement = document.getElementById(errorId!)
      expect(errorElement).toHaveTextContent('Error message')
    })
  })

  describe('disabled state', () => {
    it('should disable the input when disabled is true', () => {
      render(<InlineEditableUrl value="https://example.com" onChange={vi.fn()} disabled />)

      const input = screen.getByRole('textbox')
      expect(input).toBeDisabled()
    })

    it('should apply disabled styling', () => {
      render(<InlineEditableUrl value="https://example.com" onChange={vi.fn()} disabled />)

      const input = screen.getByRole('textbox')
      expect(input.className).toContain('cursor-not-allowed')
      expect(input.className).toContain('opacity-60')
    })
  })

  describe('onEnter', () => {
    it('should call onEnter when Enter is pressed', async () => {
      const user = userEvent.setup()
      const mockOnEnter = vi.fn()
      render(<InlineEditableUrl value="https://example.com" onChange={vi.fn()} onEnter={mockOnEnter} />)

      const input = screen.getByRole('textbox')
      await user.type(input, '{Enter}')

      expect(mockOnEnter).toHaveBeenCalled()
    })
  })
})
