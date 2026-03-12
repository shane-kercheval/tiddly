/**
 * Tests for ArgumentsBuilder component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArgumentsBuilder } from './ArgumentsBuilder'
import type { PromptArgument } from '../types'

describe('ArgumentsBuilder', () => {
  const defaultProps = {
    arguments: [] as PromptArgument[],
    onChange: vi.fn(),
  }

  beforeEach(() => {
    window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia
  })

  describe('progressive character limit', () => {
    it('should not set maxLength on arg name input', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'arg', description: null, required: false }]}
          maxNameLength={10}
        />
      )

      const nameInput = screen.getByLabelText('Argument 1 name')
      expect(nameInput).not.toHaveAttribute('maxLength')
    })

    it('should not set maxLength on arg description input', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'arg', description: 'desc', required: false }]}
          maxDescriptionLength={10}
        />
      )

      const descInput = screen.getByLabelText('Argument 1 description')
      expect(descInput).not.toHaveAttribute('maxLength')
    })

    it('should allow typing beyond the limit', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      render(
        <ArgumentsBuilder
          arguments={[{ name: 'abcde', description: null, required: false }]}
          onChange={mockOnChange}
          maxNameLength={5}
        />
      )

      const nameInput = screen.getByLabelText('Argument 1 name')
      await user.type(nameInput, 'x')

      expect(mockOnChange).toHaveBeenCalled()
    })

    it('should show "Character limit reached" when arg name is at maxNameLength', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'abcde', description: null, required: false }]}
          maxNameLength={5}
        />
      )

      expect(screen.getByText('Character limit reached')).toBeInTheDocument()
    })

    it('should show exceeded message when arg name exceeds maxNameLength', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'abcdef', description: null, required: false }]}
          maxNameLength={5}
        />
      )

      expect(screen.getByText('Character limit exceeded - saving is disabled')).toBeInTheDocument()
    })

    it('should show red border on arg name input only when exceeded', () => {
      // At exactly limit - no red border
      const { unmount } = render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'abcde', description: null, required: false }]}
          maxNameLength={5}
        />
      )
      let nameInput = screen.getByLabelText('Argument 1 name')
      expect(nameInput.className).not.toContain('ring-red-200')
      unmount()

      // Above limit - red border
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'abcdef', description: null, required: false }]}
          maxNameLength={5}
        />
      )
      nameInput = screen.getByLabelText('Argument 1 name')
      expect(nameInput.className).toContain('ring-red-200')
    })

    it('should show "Character limit reached" when arg description is at maxDescriptionLength', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'arg', description: '12345', required: false }]}
          maxDescriptionLength={5}
        />
      )

      expect(screen.getByText('Character limit reached')).toBeInTheDocument()
    })

    it('should not show limit feedback when under limits', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'arg', description: 'desc', required: false }]}
          maxNameLength={100}
          maxDescriptionLength={100}
        />
      )

      // All feedback elements should be hidden (below 70%)
      const feedbacks = screen.getAllByTestId('character-limit-feedback')
      feedbacks.forEach(feedback => {
        expect(feedback.style.visibility).toBe('hidden')
      })
    })

    it('should show counter at 70%+ for arg name', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'abcdefg', description: null, required: false }]}
          maxNameLength={10}
        />
      )

      expect(screen.getByText('7 / 10')).toBeInTheDocument()
    })
  })

  describe('pattern validation feedback', () => {
    it('should show pattern error for invalid arg name', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'invalid;name', description: null, required: false }]}
        />
      )

      expect(screen.getByText(/Must start with a letter/)).toBeInTheDocument()
    })

    it('should show red border for invalid arg name', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'invalid;name', description: null, required: false }]}
        />
      )

      const nameInput = screen.getByLabelText('Argument 1 name')
      expect(nameInput.className).toContain('ring-red-200')
    })

    it('should not show pattern error for valid arg name', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'valid_name', description: null, required: false }]}
        />
      )

      expect(screen.queryByText(/Must start with a letter/)).not.toBeInTheDocument()
    })

    it('should not show pattern error for empty arg name', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: '', description: null, required: false }]}
        />
      )

      expect(screen.queryByText(/Must start with a letter/)).not.toBeInTheDocument()
    })

    it('should show pattern error alongside limit feedback', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'invalid;name', description: '12345', required: false }]}
          maxDescriptionLength={5}
        />
      )

      expect(screen.getByText(/Must start with a letter/)).toBeInTheDocument()
      expect(screen.getByText('Character limit reached')).toBeInTheDocument()
    })
  })
})
