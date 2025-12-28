import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PaginationControls } from './PaginationControls'
import type { PageSize } from '../../stores/uiPreferencesStore'

const defaultProps = {
  currentPage: 1,
  totalPages: 5,
  pageSize: 10 as PageSize,
  hasMore: true,
  offset: 0,
  total: 50,
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
}

describe('PaginationControls', () => {
  describe('rendering', () => {
    it('should render Previous and Next buttons', () => {
      render(<PaginationControls {...defaultProps} />)

      expect(screen.getByText('Previous')).toBeInTheDocument()
      expect(screen.getByText('Next')).toBeInTheDocument()
    })

    it('should render current page and total pages', () => {
      render(<PaginationControls {...defaultProps} />)

      expect(screen.getByText('Page 1 of 5')).toBeInTheDocument()
    })

    it('should render page size dropdown', () => {
      render(<PaginationControls {...defaultProps} />)

      const select = screen.getByRole('combobox')
      expect(select).toBeInTheDocument()
      expect(select).toHaveValue('10')
    })

    it('should render all page size options', () => {
      render(<PaginationControls {...defaultProps} />)

      expect(screen.getByRole('option', { name: '10 per page' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: '15 per page' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: '20 per page' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: '30 per page' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: '50 per page' })).toBeInTheDocument()
    })
  })

  describe('visibility', () => {
    it('should not render when only one page and total <= smallest page size', () => {
      const { container } = render(
        <PaginationControls
          {...defaultProps}
          totalPages={1}
          total={5}
        />
      )

      expect(container).toBeEmptyDOMElement()
    })

    it('should render when multiple pages', () => {
      render(
        <PaginationControls
          {...defaultProps}
          totalPages={2}
          total={15}
        />
      )

      expect(screen.getByText('Previous')).toBeInTheDocument()
    })

    it('should render when total exceeds smallest page size even with one page', () => {
      render(
        <PaginationControls
          {...defaultProps}
          totalPages={1}
          total={15}
          pageSize={20 as PageSize}
        />
      )

      expect(screen.getByText('Previous')).toBeInTheDocument()
    })
  })

  describe('button states', () => {
    it('should disable Previous button on first page', () => {
      render(
        <PaginationControls
          {...defaultProps}
          currentPage={1}
          offset={0}
        />
      )

      expect(screen.getByText('Previous')).toBeDisabled()
    })

    it('should enable Previous button when not on first page', () => {
      render(
        <PaginationControls
          {...defaultProps}
          currentPage={2}
          offset={10}
        />
      )

      expect(screen.getByText('Previous')).not.toBeDisabled()
    })

    it('should disable Next button when no more pages', () => {
      render(
        <PaginationControls
          {...defaultProps}
          hasMore={false}
        />
      )

      expect(screen.getByText('Next')).toBeDisabled()
    })

    it('should enable Next button when there are more pages', () => {
      render(
        <PaginationControls
          {...defaultProps}
          hasMore={true}
        />
      )

      expect(screen.getByText('Next')).not.toBeDisabled()
    })
  })

  describe('interactions', () => {
    it('should call onPageChange with previous offset when clicking Previous', () => {
      const onPageChange = vi.fn()
      render(
        <PaginationControls
          {...defaultProps}
          currentPage={2}
          offset={10}
          onPageChange={onPageChange}
        />
      )

      fireEvent.click(screen.getByText('Previous'))

      expect(onPageChange).toHaveBeenCalledWith(0)
    })

    it('should call onPageChange with next offset when clicking Next', () => {
      const onPageChange = vi.fn()
      render(
        <PaginationControls
          {...defaultProps}
          offset={0}
          pageSize={10 as PageSize}
          onPageChange={onPageChange}
        />
      )

      fireEvent.click(screen.getByText('Next'))

      expect(onPageChange).toHaveBeenCalledWith(10)
    })

    it('should call onPageSizeChange when changing page size', () => {
      const onPageSizeChange = vi.fn()
      render(
        <PaginationControls
          {...defaultProps}
          onPageSizeChange={onPageSizeChange}
        />
      )

      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: '20' } })

      expect(onPageSizeChange).toHaveBeenCalledWith(20)
    })

    it('should not allow going to negative offset', () => {
      const onPageChange = vi.fn()
      render(
        <PaginationControls
          {...defaultProps}
          currentPage={1}
          offset={5}
          pageSize={10 as PageSize}
          onPageChange={onPageChange}
        />
      )

      fireEvent.click(screen.getByText('Previous'))

      // Should be clamped to 0
      expect(onPageChange).toHaveBeenCalledWith(0)
    })
  })

  describe('page display', () => {
    it('should show correct page info for middle pages', () => {
      render(
        <PaginationControls
          {...defaultProps}
          currentPage={3}
          totalPages={5}
        />
      )

      expect(screen.getByText('Page 3 of 5')).toBeInTheDocument()
    })

    it('should show correct page info for last page', () => {
      render(
        <PaginationControls
          {...defaultProps}
          currentPage={5}
          totalPages={5}
          hasMore={false}
        />
      )

      expect(screen.getByText('Page 5 of 5')).toBeInTheDocument()
    })
  })

  describe('page size selection', () => {
    it('should reflect current page size in dropdown', () => {
      render(
        <PaginationControls
          {...defaultProps}
          pageSize={30 as PageSize}
        />
      )

      const select = screen.getByRole('combobox')
      expect(select).toHaveValue('30')
    })
  })
})
