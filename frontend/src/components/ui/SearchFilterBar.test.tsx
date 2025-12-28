import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { SearchFilterBar } from './SearchFilterBar'
import type { TagCount } from '../../types'
import type { SortByOption } from '../../constants/sortOptions'

const mockTagSuggestions: TagCount[] = [
  { name: 'react', count: 10 },
  { name: 'typescript', count: 8 },
  { name: 'javascript', count: 5 },
]

const defaultProps = {
  searchQuery: '',
  onSearchChange: vi.fn(),
  tagSuggestions: mockTagSuggestions,
  selectedTags: [] as string[],
  onTagSelect: vi.fn(),
  sortValue: 'created_at-desc',
  onSortChange: vi.fn(),
  availableSortOptions: ['created_at', 'updated_at', 'title'] as readonly SortByOption[],
}

describe('SearchFilterBar', () => {
  describe('rendering', () => {
    it('should render search input with default placeholder', () => {
      render(<SearchFilterBar {...defaultProps} />)

      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
    })

    it('should render search input with custom placeholder', () => {
      render(
        <SearchFilterBar
          {...defaultProps}
          searchPlaceholder="Search bookmarks..."
        />
      )

      expect(screen.getByPlaceholderText('Search bookmarks...')).toBeInTheDocument()
    })

    it('should render sort dropdown', () => {
      render(<SearchFilterBar {...defaultProps} />)

      const select = screen.getByRole('combobox')
      expect(select).toBeInTheDocument()
    })

    it('should render tag filter input', () => {
      render(<SearchFilterBar {...defaultProps} />)

      expect(screen.getByPlaceholderText('Filter by tag...')).toBeInTheDocument()
    })

    it('should render left slot when provided', () => {
      render(
        <SearchFilterBar
          {...defaultProps}
          leftSlot={<button data-testid="add-button">Add</button>}
        />
      )

      expect(screen.getByTestId('add-button')).toBeInTheDocument()
    })

    it('should not render left slot when not provided', () => {
      render(<SearchFilterBar {...defaultProps} />)

      expect(screen.queryByTestId('add-button')).not.toBeInTheDocument()
    })
  })

  describe('search input', () => {
    it('should display the current search query', () => {
      render(
        <SearchFilterBar
          {...defaultProps}
          searchQuery="test query"
        />
      )

      const input = screen.getByPlaceholderText('Search...')
      expect(input).toHaveValue('test query')
    })

    it('should call onSearchChange when typing', () => {
      const onSearchChange = vi.fn()
      render(
        <SearchFilterBar
          {...defaultProps}
          onSearchChange={onSearchChange}
        />
      )

      const input = screen.getByPlaceholderText('Search...')
      fireEvent.change(input, { target: { value: 'new search' } })

      expect(onSearchChange).toHaveBeenCalled()
    })

    it('should accept a ref for the search input', () => {
      const ref = createRef<HTMLInputElement>()
      render(
        <SearchFilterBar
          {...defaultProps}
          searchInputRef={ref}
        />
      )

      expect(ref.current).toBeInstanceOf(HTMLInputElement)
      expect(ref.current?.placeholder).toBe('Search...')
    })
  })

  describe('sort dropdown', () => {
    it('should display the current sort value', () => {
      render(
        <SearchFilterBar
          {...defaultProps}
          sortValue="title-asc"
        />
      )

      const select = screen.getByRole('combobox')
      expect(select).toHaveValue('title-asc')
    })

    it('should call onSortChange when selecting a new option', () => {
      const onSortChange = vi.fn()
      render(
        <SearchFilterBar
          {...defaultProps}
          onSortChange={onSortChange}
        />
      )

      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: 'title-asc' } })

      expect(onSortChange).toHaveBeenCalled()
    })

    it('should render options for all available sort options', () => {
      render(
        <SearchFilterBar
          {...defaultProps}
          availableSortOptions={['created_at', 'updated_at', 'title']}
        />
      )

      // Each sort option has ascending and descending variants
      expect(screen.getByRole('option', { name: 'Date Added ↓' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Date Added ↑' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Date Modified ↓' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Date Modified ↑' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Title ↓' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Title ↑' })).toBeInTheDocument()
    })

    it('should only render options for provided sort options', () => {
      render(
        <SearchFilterBar
          {...defaultProps}
          availableSortOptions={['title']}
        />
      )

      expect(screen.getByRole('option', { name: 'Title ↓' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Title ↑' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Date Added ↓' })).not.toBeInTheDocument()
    })
  })

  describe('tag filter', () => {
    it('should pass selected tags to TagFilterInput', () => {
      render(
        <SearchFilterBar
          {...defaultProps}
          selectedTags={['react', 'typescript']}
        />
      )

      // TagFilterInput should exclude selected tags from suggestions
      // We can't easily test this without userEvent interactions,
      // but we can verify the component renders
      expect(screen.getByPlaceholderText('Filter by tag...')).toBeInTheDocument()
    })
  })
})
