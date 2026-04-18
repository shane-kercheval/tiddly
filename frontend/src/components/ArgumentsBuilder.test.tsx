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

  // -------------------------------------------------------------------------
  // AI suggestion icons (per-row sparkle UX)
  // -------------------------------------------------------------------------

  describe('AI suggestion icons', () => {
    const aiProps = {
      onSuggestAll: vi.fn(),
      isSuggestingAll: false,
      suggestAllDisabled: false,
      suggestAllTooltip: 'Add prompt content to enable AI argument generation',
      onSuggestRow: vi.fn(),
      suggestingAnyRow: false,
      isSuggestingRow: (): boolean => false,
      rowSuggestDisabled: (): boolean => false,
      rowSuggestTooltip: (): string => 'Suggest name',
    }

    it('shows generate-all icon when onSuggestAll provided', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
        />,
      )
      expect(screen.getByLabelText('Generate arguments from template')).toBeInTheDocument()
    })

    it('hides all AI icons when onSuggestAll not provided', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          arguments={[{ name: 'arg1', description: 'desc', required: false }]}
        />,
      )
      expect(screen.queryByLabelText('Generate arguments from template')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Suggest fields for argument 1')).not.toBeInTheDocument()
    })

    it('shows one per-row sparkle when AI available and arguments exist', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          arguments={[
            { name: 'arg1', description: 'desc', required: false },
            { name: 'arg2', description: null, required: false },
          ]}
        />,
      )
      // Exactly one sparkle per row, placed next to the remove button.
      expect(screen.getByLabelText('Suggest fields for argument 1')).toBeInTheDocument()
      expect(screen.getByLabelText('Suggest fields for argument 2')).toBeInTheDocument()
    })

    it('inputs no longer contain sparkle children (per-field sparkles removed)', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          arguments={[{ name: 'arg1', description: 'desc', required: false }]}
        />,
      )
      // The old per-field sparkles used aria-labels like "Suggest name for
      // argument 1" / "Suggest description for argument 1". They must be
      // gone under the per-row UX.
      expect(screen.queryByLabelText('Suggest name for argument 1')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Suggest description for argument 1')).not.toBeInTheDocument()
    })

    it('calls onSuggestAll when generate-all icon clicked', async () => {
      const user = userEvent.setup()
      const onSuggestAll = vi.fn()
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          onSuggestAll={onSuggestAll}
        />,
      )
      await user.click(screen.getByLabelText('Generate arguments from template'))
      expect(onSuggestAll).toHaveBeenCalled()
    })

    it('disables generate-all icon when suggestAllDisabled is true', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          suggestAllDisabled={true}
        />,
      )
      expect(screen.getByLabelText('Generate arguments from template')).toBeDisabled()
    })

    it('disables generate-all while any per-row suggestion is in flight', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          suggestingAnyRow={true}
          arguments={[{ name: '', description: 'desc', required: false }]}
        />,
      )
      expect(screen.getByLabelText('Generate arguments from template')).toBeDisabled()
    })

    it('calls onSuggestRow with index when row sparkle clicked', async () => {
      const user = userEvent.setup()
      const onSuggestRow = vi.fn()
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          onSuggestRow={onSuggestRow}
          arguments={[
            { name: '', description: 'has desc', required: false },
            { name: 'arg2', description: null, required: false },
          ]}
        />,
      )
      await user.click(screen.getByLabelText('Suggest fields for argument 2'))
      expect(onSuggestRow).toHaveBeenCalledWith(1)
    })

    it('disables row sparkle when rowSuggestDisabled returns true', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          rowSuggestDisabled={(): boolean => true}
          arguments={[{ name: 'arg1', description: 'desc', required: false }]}
        />,
      )
      expect(screen.getByLabelText('Suggest fields for argument 1')).toBeDisabled()
    })

    it('shows spinner on row sparkle when isSuggestingRow returns true for that index', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          isSuggestingRow={(i: number) => i === 0}
          arguments={[{ name: '', description: 'desc', required: false }]}
        />,
      )
      const button = screen.getByLabelText('Suggest fields for argument 1')
      expect(button.querySelector('.spinner-ai')).toBeInTheDocument()
      expect(button).toHaveAttribute('aria-busy', 'true')
    })

    it('disables all other per-row sparkles when suggestingAnyRow is true (serialization)', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          suggestingAnyRow={true}
          isSuggestingRow={(i: number) => i === 0}
          arguments={[
            { name: '', description: 'desc1', required: false },
            { name: '', description: 'desc2', required: false },
          ]}
        />,
      )
      // Row 0 is the active request (disabled via in-flight), row 1 is
      // disabled via the serialization gate.
      expect(screen.getByLabelText('Suggest fields for argument 1')).toBeDisabled()
      expect(screen.getByLabelText('Suggest fields for argument 2')).toBeDisabled()
    })

    it('disables per-row sparkles during generate-all (existing behavior preserved)', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          isSuggestingAll={true}
          arguments={[{ name: '', description: 'desc', required: false }]}
        />,
      )
      expect(screen.getByLabelText('Suggest fields for argument 1')).toBeDisabled()
    })

    it('marks generate-all sparkle as aria-busy while suggesting all', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          isSuggestingAll={true}
        />,
      )
      expect(screen.getByLabelText('Generate arguments from template')).toHaveAttribute('aria-busy', 'true')
    })

    // -----------------------------------------------------------------------
    // Priority: suppress tooltip on in-flight / globally-disabled states
    // -----------------------------------------------------------------------
    // Presence of the Tooltip wrapper is observable via the button's parent
    // className: Tooltip's trigger wrapper uses `inline-flex`. When
    // MaybeTooltip skips rendering (empty content), the button is a direct
    // child of the row's flex container with a different class.

    it('no custom tooltip on per-row sparkle during cross-row serialization', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          suggestingAnyRow={true}
          isSuggestingRow={(i: number) => i === 0}
          rowSuggestTooltip={(): string => 'Suggest name'}
          arguments={[
            { name: '', description: 'desc1', required: false },
            { name: '', description: 'desc2', required: false },
          ]}
        />,
      )
      // Row 2's sparkle is disabled purely via serialization — no custom
      // tooltip should wrap it.
      const sparkle = screen.getByLabelText('Suggest fields for argument 2')
      expect(sparkle.parentElement?.className ?? '').not.toContain('inline-flex')
    })

    it('no custom tooltip on per-row sparkle when globally disabled', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          disabled={true}
          rowSuggestTooltip={(): string => 'Suggest name'}
          arguments={[{ name: '', description: 'desc', required: false }]}
        />,
      )
      const sparkle = screen.getByLabelText('Suggest fields for argument 1')
      expect(sparkle.parentElement?.className ?? '').not.toContain('inline-flex')
    })

    it('no custom tooltip on per-row sparkle when its own request is in flight', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          isSuggestingRow={(): boolean => true}
          rowSuggestTooltip={(): string => 'Suggest name'}
          arguments={[{ name: '', description: 'desc', required: false }]}
        />,
      )
      const sparkle = screen.getByLabelText('Suggest fields for argument 1')
      expect(sparkle.parentElement?.className ?? '').not.toContain('inline-flex')
    })

    it('wraps per-row sparkle in Tooltip when enabled with a state-aware string', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          rowSuggestTooltip={(): string => 'Suggest name'}
          arguments={[{ name: '', description: 'desc', required: false }]}
        />,
      )
      const sparkle = screen.getByLabelText('Suggest fields for argument 1')
      // Enabled → MaybeTooltip wraps in Tooltip trigger (inline-flex).
      expect(sparkle.parentElement?.className ?? '').toContain('inline-flex')
    })

    it('no custom tooltip on generate-all when disabled via suggestingAnyRow', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          suggestingAnyRow={true}
          arguments={[{ name: '', description: 'desc', required: false }]}
        />,
      )
      const generateAll = screen.getByLabelText('Generate arguments from template')
      expect(generateAll.parentElement?.className ?? '').not.toContain('inline-flex')
    })

    it('no custom tooltip on generate-all when disabled via in-flight generate-all', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          isSuggestingAll={true}
        />,
      )
      const generateAll = screen.getByLabelText('Generate arguments from template')
      expect(generateAll.parentElement?.className ?? '').not.toContain('inline-flex')
    })

    it('shows custom tooltip on generate-all when disabled via suggestAllDisabled', () => {
      render(
        <ArgumentsBuilder
          {...defaultProps}
          {...aiProps}
          suggestAllDisabled={true}
          suggestAllTooltip="No {{ placeholders }} found in template"
        />,
      )
      const generateAll = screen.getByLabelText('Generate arguments from template')
      // suggestAllDisabled is the caller-provided actionable reason — keep
      // the tooltip so the user knows what to fix.
      expect(generateAll.parentElement?.className ?? '').toContain('inline-flex')
    })
  })
})
