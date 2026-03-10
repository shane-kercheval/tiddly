/**
 * Tests for ArgumentsBuilder component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArgumentsBuilder } from './ArgumentsBuilder'
import type { PromptArgument } from '../types'

describe('ArgumentsBuilder', () => {
  const defaultProps = {
    arguments: [] as PromptArgument[],
    onChange: vi.fn(),
  }

  describe('character limit feedback', () => {
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

    it('should show red border on arg name input when at limit', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'abcde', description: null, required: false }]}
          maxNameLength={5}
        />
      )

      const nameInput = screen.getByLabelText('Argument 1 name')
      expect(nameInput.className).toContain('ring-red-200')
    })

    it('should not call onChange when arg name exceeds maxNameLength', async () => {
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

      expect(mockOnChange).not.toHaveBeenCalled()
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

    it('should show red border on arg description input when at limit', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'arg', description: '12345', required: false }]}
          maxDescriptionLength={5}
        />
      )

      const descInput = screen.getByLabelText('Argument 1 description')
      expect(descInput.className).toContain('ring-red-200')
    })

    it('should not show limit feedback when under limits', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'arg', description: 'desc', required: false }]}
          maxNameLength={10}
          maxDescriptionLength={10}
        />
      )

      expect(screen.queryByText('Character limit reached')).not.toBeInTheDocument()
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

    it('should prioritize pattern error over limit message', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'a;b', description: null, required: false }]}
          maxNameLength={3}
        />
      )

      expect(screen.getByText(/Must start with a letter/)).toBeInTheDocument()
      expect(screen.queryByText('Character limit reached')).not.toBeInTheDocument()
    })
  })
})
