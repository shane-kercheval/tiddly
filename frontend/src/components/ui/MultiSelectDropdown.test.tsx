/**
 * Tests for MultiSelectDropdown component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MultiSelectDropdown } from './MultiSelectDropdown'
import type { DropdownOption } from './MultiSelectDropdown'

const mockOptions: DropdownOption<string>[] = [
  { value: 'option1', label: 'Option 1' },
  { value: 'option2', label: 'Option 2' },
  { value: 'option3', label: 'Option 3' },
]

describe('MultiSelectDropdown', () => {
  describe('rendering', () => {
    it('renders trigger button with label', () => {
      render(
        <MultiSelectDropdown
          label="Test Label"
          options={mockOptions}
          selected={[]}
          onChange={vi.fn()}
        />
      )

      expect(screen.getByText('Test Label')).toBeInTheDocument()
    })

    it('renders trigger with count when items are selected', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={['option1', 'option2']}
          onChange={vi.fn()}
        />
      )

      expect(screen.getByText('Test (2)')).toBeInTheDocument()
    })

    it('renders with testId when provided', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={[]}
          onChange={vi.fn()}
          testId="my-dropdown"
        />
      )

      expect(screen.getByTestId('my-dropdown')).toBeInTheDocument()
    })

    it('renders options with icons when provided', () => {
      const optionsWithIcons: DropdownOption<string>[] = [
        { value: 'opt1', label: 'With Icon', icon: <span data-testid="icon">Icon</span> },
      ]

      render(
        <MultiSelectDropdown
          label="Test"
          options={optionsWithIcons}
          selected={[]}
          onChange={vi.fn()}
        />
      )

      // Open dropdown
      fireEvent.click(screen.getByText('Test'))

      expect(screen.getByTestId('icon')).toBeInTheDocument()
    })
  })

  describe('dropdown behavior', () => {
    it('shows options when clicked', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={[]}
          onChange={vi.fn()}
          testId="dropdown"
        />
      )

      // Options should not be visible initially
      expect(screen.queryByTestId('dropdown-menu')).not.toBeInTheDocument()

      // Click to open
      fireEvent.click(screen.getByTestId('dropdown'))

      // Options should now be visible
      expect(screen.getByTestId('dropdown-menu')).toBeInTheDocument()
      expect(screen.getByText('Option 1')).toBeInTheDocument()
      expect(screen.getByText('Option 2')).toBeInTheDocument()
      expect(screen.getByText('Option 3')).toBeInTheDocument()
    })

    it('closes when clicking outside', () => {
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <MultiSelectDropdown
            label="Test"
            options={mockOptions}
            selected={[]}
            onChange={vi.fn()}
            testId="dropdown"
          />
        </div>
      )

      // Open dropdown
      fireEvent.click(screen.getByTestId('dropdown'))
      expect(screen.getByTestId('dropdown-menu')).toBeInTheDocument()

      // Click outside
      fireEvent.mouseDown(screen.getByTestId('outside'))

      // Should be closed
      expect(screen.queryByTestId('dropdown-menu')).not.toBeInTheDocument()
    })

    it('closes when pressing Escape', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={[]}
          onChange={vi.fn()}
          testId="dropdown"
        />
      )

      // Open dropdown
      fireEvent.click(screen.getByTestId('dropdown'))
      expect(screen.getByTestId('dropdown-menu')).toBeInTheDocument()

      // Press Escape
      fireEvent.keyDown(document, { key: 'Escape' })

      // Should be closed
      expect(screen.queryByTestId('dropdown-menu')).not.toBeInTheDocument()
    })

    it('stays open when clicking options (multi-select behavior)', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={[]}
          onChange={vi.fn()}
          testId="dropdown"
        />
      )

      // Open dropdown
      fireEvent.click(screen.getByTestId('dropdown'))

      // Click an option
      fireEvent.click(screen.getByTestId('dropdown-option-option1'))

      // Dropdown should still be open
      expect(screen.getByTestId('dropdown-menu')).toBeInTheDocument()
    })
  })

  describe('selection', () => {
    it('calls onChange when option is clicked', () => {
      const onChange = vi.fn()
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={[]}
          onChange={onChange}
          testId="dropdown"
        />
      )

      fireEvent.click(screen.getByTestId('dropdown'))
      fireEvent.click(screen.getByTestId('dropdown-option-option1'))

      expect(onChange).toHaveBeenCalledWith('option1')
    })

    it('shows checkbox checked for selected options', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={['option1', 'option3']}
          onChange={vi.fn()}
          testId="dropdown"
        />
      )

      fireEvent.click(screen.getByTestId('dropdown'))

      // Check aria-selected attributes
      expect(screen.getByTestId('dropdown-option-option1')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('dropdown-option-option2')).toHaveAttribute('aria-selected', 'false')
      expect(screen.getByTestId('dropdown-option-option3')).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('styling', () => {
    it('applies default styling when no items are selected', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={[]}
          onChange={vi.fn()}
          testId="dropdown"
        />
      )

      // Not selected - should have gray styling matching app's select dropdowns
      expect(screen.getByTestId('dropdown')).toHaveClass('border-gray-200', 'bg-gray-50/50')
    })

    it('applies active styling when items are selected', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={['option1']}
          onChange={vi.fn()}
          testId="dropdown"
        />
      )

      // With selection - should have blue styling
      expect(screen.getByTestId('dropdown')).toHaveClass('border-blue-200', 'bg-blue-50/50', 'text-blue-700')
    })
  })

  describe('toggle all', () => {
    it('shows "Select all" when nothing is selected', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={[]}
          onChange={vi.fn()}
          onToggleAll={vi.fn()}
          testId="dropdown"
        />
      )

      fireEvent.click(screen.getByTestId('dropdown'))

      expect(screen.getByTestId('dropdown-toggle-all')).toHaveTextContent('Select all')
    })

    it('shows "Select all" when some items are selected', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={['option1']}
          onChange={vi.fn()}
          onToggleAll={vi.fn()}
          testId="dropdown"
        />
      )

      fireEvent.click(screen.getByTestId('dropdown'))

      expect(screen.getByTestId('dropdown-toggle-all')).toHaveTextContent('Select all')
    })

    it('shows "Deselect all" when all items are selected', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={['option1', 'option2', 'option3']}
          onChange={vi.fn()}
          onToggleAll={vi.fn()}
          testId="dropdown"
        />
      )

      fireEvent.click(screen.getByTestId('dropdown'))

      expect(screen.getByTestId('dropdown-toggle-all')).toHaveTextContent('Deselect all')
    })

    it('calls onToggleAll with true when selecting all', () => {
      const onToggleAll = vi.fn()
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={[]}
          onChange={vi.fn()}
          onToggleAll={onToggleAll}
          testId="dropdown"
        />
      )

      fireEvent.click(screen.getByTestId('dropdown'))
      fireEvent.click(screen.getByTestId('dropdown-toggle-all'))

      expect(onToggleAll).toHaveBeenCalledWith(true)
    })

    it('calls onToggleAll with false when deselecting all', () => {
      const onToggleAll = vi.fn()
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={['option1', 'option2', 'option3']}
          onChange={vi.fn()}
          onToggleAll={onToggleAll}
          testId="dropdown"
        />
      )

      fireEvent.click(screen.getByTestId('dropdown'))
      fireEvent.click(screen.getByTestId('dropdown-toggle-all'))

      expect(onToggleAll).toHaveBeenCalledWith(false)
    })

    it('does not show toggle all when onToggleAll is not provided', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={[]}
          onChange={vi.fn()}
          testId="dropdown"
        />
      )

      fireEvent.click(screen.getByTestId('dropdown'))

      expect(screen.queryByTestId('dropdown-toggle-all')).not.toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('has correct aria attributes on trigger', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={[]}
          onChange={vi.fn()}
          testId="dropdown"
        />
      )

      const trigger = screen.getByTestId('dropdown')
      expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')

      // Open dropdown
      fireEvent.click(trigger)
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })

    it('has correct aria attributes on menu', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={[]}
          onChange={vi.fn()}
          testId="dropdown"
        />
      )

      fireEvent.click(screen.getByTestId('dropdown'))

      const menu = screen.getByTestId('dropdown-menu')
      expect(menu).toHaveAttribute('role', 'listbox')
      expect(menu).toHaveAttribute('aria-multiselectable', 'true')
    })

    it('has correct role on options', () => {
      render(
        <MultiSelectDropdown
          label="Test"
          options={mockOptions}
          selected={[]}
          onChange={vi.fn()}
          testId="dropdown"
        />
      )

      fireEvent.click(screen.getByTestId('dropdown'))

      expect(screen.getByTestId('dropdown-option-option1')).toHaveAttribute('role', 'option')
    })
  })
})
