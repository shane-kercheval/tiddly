import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SelectedTagsDisplay } from './SelectedTagsDisplay'

const defaultProps = {
  selectedTags: ['react', 'typescript'],
  tagMatch: 'all' as const,
  onRemoveTag: vi.fn(),
  onTagMatchChange: vi.fn(),
  onClearFilters: vi.fn(),
}

describe('SelectedTagsDisplay', () => {
  describe('rendering', () => {
    it('should render nothing when no tags are selected', () => {
      const { container } = render(
        <SelectedTagsDisplay
          {...defaultProps}
          selectedTags={[]}
        />
      )

      expect(container).toBeEmptyDOMElement()
    })

    it('should render selected tags as badges', () => {
      render(<SelectedTagsDisplay {...defaultProps} />)

      expect(screen.getByText('react')).toBeInTheDocument()
      expect(screen.getByText('typescript')).toBeInTheDocument()
    })

    it('should render "Filtering by:" label', () => {
      render(<SelectedTagsDisplay {...defaultProps} />)

      expect(screen.getByText('Filtering by:')).toBeInTheDocument()
    })

    it('should render tag match dropdown when multiple tags selected', () => {
      render(<SelectedTagsDisplay {...defaultProps} />)

      const select = screen.getByRole('combobox')
      expect(select).toBeInTheDocument()
      expect(select).toHaveValue('all')
    })

    it('should not render tag match dropdown when only one tag selected', () => {
      render(
        <SelectedTagsDisplay
          {...defaultProps}
          selectedTags={['react']}
        />
      )

      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    })

    it('should render clear button when multiple tags selected', () => {
      render(<SelectedTagsDisplay {...defaultProps} />)

      expect(screen.getByText('Clear')).toBeInTheDocument()
    })

    it('should not render clear button when only one tag selected', () => {
      render(
        <SelectedTagsDisplay
          {...defaultProps}
          selectedTags={['react']}
        />
      )

      expect(screen.queryByText('Clear')).not.toBeInTheDocument()
    })
  })

  describe('interactions', () => {
    it('should call onRemoveTag when clicking a tag badge', () => {
      const onRemoveTag = vi.fn()
      render(
        <SelectedTagsDisplay
          {...defaultProps}
          onRemoveTag={onRemoveTag}
        />
      )

      fireEvent.click(screen.getByText('react'))

      expect(onRemoveTag).toHaveBeenCalledWith('react')
    })

    it('should call onRemoveTag with correct tag for each badge', () => {
      const onRemoveTag = vi.fn()
      render(
        <SelectedTagsDisplay
          {...defaultProps}
          onRemoveTag={onRemoveTag}
        />
      )

      fireEvent.click(screen.getByText('typescript'))

      expect(onRemoveTag).toHaveBeenCalledWith('typescript')
    })

    it('should call onTagMatchChange when changing match mode', () => {
      const onTagMatchChange = vi.fn()
      render(
        <SelectedTagsDisplay
          {...defaultProps}
          onTagMatchChange={onTagMatchChange}
        />
      )

      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: 'any' } })

      expect(onTagMatchChange).toHaveBeenCalled()
    })

    it('should call onClearFilters when clicking clear button', () => {
      const onClearFilters = vi.fn()
      render(
        <SelectedTagsDisplay
          {...defaultProps}
          onClearFilters={onClearFilters}
        />
      )

      fireEvent.click(screen.getByText('Clear'))

      expect(onClearFilters).toHaveBeenCalled()
    })
  })

  describe('tag match options', () => {
    it('should display "Match all" option', () => {
      render(<SelectedTagsDisplay {...defaultProps} />)

      expect(screen.getByRole('option', { name: 'Match all' })).toBeInTheDocument()
    })

    it('should display "Match any" option', () => {
      render(<SelectedTagsDisplay {...defaultProps} />)

      expect(screen.getByRole('option', { name: 'Match any' })).toBeInTheDocument()
    })

    it('should show correct selected value for tagMatch', () => {
      render(
        <SelectedTagsDisplay
          {...defaultProps}
          tagMatch="any"
        />
      )

      const select = screen.getByRole('combobox')
      expect(select).toHaveValue('any')
    })
  })

  describe('edge cases', () => {
    it('should handle many tags', () => {
      const manyTags = ['react', 'typescript', 'javascript', 'python', 'rust', 'go']
      render(
        <SelectedTagsDisplay
          {...defaultProps}
          selectedTags={manyTags}
        />
      )

      manyTags.forEach((tag) => {
        expect(screen.getByText(tag)).toBeInTheDocument()
      })
    })

    it('should handle tags with special characters', () => {
      render(
        <SelectedTagsDisplay
          {...defaultProps}
          selectedTags={['machine-learning', 'node.js']}
        />
      )

      expect(screen.getByText('machine-learning')).toBeInTheDocument()
      expect(screen.getByText('node.js')).toBeInTheDocument()
    })
  })
})
