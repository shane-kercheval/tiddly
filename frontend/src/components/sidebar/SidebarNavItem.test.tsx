/**
 * Tests for SidebarNavItem component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { SidebarNavItem } from './SidebarNavItem'

function createWrapper(initialEntries: string[] = ['/']) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  }
}

describe('SidebarNavItem', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic rendering', () => {
    it('should render the label', () => {
      render(
        <SidebarNavItem to="/test" label="Test Label" isCollapsed={false} />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByText('Test Label')).toBeInTheDocument()
    })

    it('should render as a navigation link', () => {
      render(
        <SidebarNavItem to="/test-path" label="Test Label" isCollapsed={false} />,
        { wrapper: createWrapper() }
      )

      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/test-path')
    })

    it('should render custom icon when provided', () => {
      render(
        <SidebarNavItem
          to="/test"
          label="Test Label"
          isCollapsed={false}
          icon={<span data-testid="custom-icon">Icon</span>}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    })

    it('should add title attribute when collapsed', () => {
      render(
        <SidebarNavItem to="/test" label="Test Label" isCollapsed={true} />,
        { wrapper: createWrapper() }
      )

      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('title', 'Test Label')
    })

    it('should hide label text visually when collapsed', () => {
      render(
        <SidebarNavItem to="/test" label="Test Label" isCollapsed={true} />,
        { wrapper: createWrapper() }
      )

      const labelSpan = screen.getByText('Test Label')
      expect(labelSpan).toHaveClass('sr-only')
    })

    it('should show label text when not collapsed', () => {
      render(
        <SidebarNavItem to="/test" label="Test Label" isCollapsed={false} />,
        { wrapper: createWrapper() }
      )

      const labelSpan = screen.getByText('Test Label')
      expect(labelSpan).not.toHaveClass('sr-only')
    })
  })

  describe('onClick handler', () => {
    it('should call onClick when clicking the link', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onClick = vi.fn()

      render(
        <SidebarNavItem
          to="/test"
          label="Test Label"
          isCollapsed={false}
          onClick={onClick}
        />,
        { wrapper: createWrapper() }
      )

      await user.click(screen.getByRole('link'))
      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('hover actions', () => {
    it('should NOT show action buttons when neither onEdit nor onDelete are provided', () => {
      render(
        <SidebarNavItem to="/test" label="Test Label" isCollapsed={false} />,
        { wrapper: createWrapper() }
      )

      expect(screen.queryByTitle('Edit list')).not.toBeInTheDocument()
      expect(screen.queryByTitle('Delete list')).not.toBeInTheDocument()
    })

    it('should show edit button when onEdit is provided', () => {
      render(
        <SidebarNavItem
          to="/test"
          label="Test Label"
          isCollapsed={false}
          onEdit={vi.fn()}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByTitle('Edit list')).toBeInTheDocument()
    })

    it('should show delete button when onDelete is provided', () => {
      render(
        <SidebarNavItem
          to="/test"
          label="Test Label"
          isCollapsed={false}
          onDelete={vi.fn()}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByTitle('Delete list')).toBeInTheDocument()
    })

    it('should NOT show action buttons when sidebar is collapsed', () => {
      render(
        <SidebarNavItem
          to="/test"
          label="Test Label"
          isCollapsed={true}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.queryByTitle('Edit list')).not.toBeInTheDocument()
      expect(screen.queryByTitle('Delete list')).not.toBeInTheDocument()
    })

    it('should call onEdit when edit button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onEdit = vi.fn()

      render(
        <SidebarNavItem
          to="/test"
          label="Test Label"
          isCollapsed={false}
          onEdit={onEdit}
        />,
        { wrapper: createWrapper() }
      )

      await user.click(screen.getByTitle('Edit list'))
      expect(onEdit).toHaveBeenCalledTimes(1)
    })
  })

  describe('two-click delete confirmation', () => {
    it('should show confirmation state on first click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onDelete = vi.fn()

      render(
        <SidebarNavItem
          to="/test"
          label="Test Label"
          isCollapsed={false}
          onDelete={onDelete}
        />,
        { wrapper: createWrapper() }
      )

      // First click
      await user.click(screen.getByTitle('Delete list'))

      // Should show confirmation text
      expect(screen.getByText('Delete?')).toBeInTheDocument()
      expect(screen.getByTitle('Click again to confirm')).toBeInTheDocument()
      expect(onDelete).not.toHaveBeenCalled()
    })

    it('should call onDelete on second click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onDelete = vi.fn()

      render(
        <SidebarNavItem
          to="/test"
          label="Test Label"
          isCollapsed={false}
          onDelete={onDelete}
        />,
        { wrapper: createWrapper() }
      )

      // First click
      await user.click(screen.getByTitle('Delete list'))

      // Second click
      await user.click(screen.getByTitle('Click again to confirm'))

      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('should reset confirmation after timeout', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onDelete = vi.fn()

      render(
        <SidebarNavItem
          to="/test"
          label="Test Label"
          isCollapsed={false}
          onDelete={onDelete}
        />,
        { wrapper: createWrapper() }
      )

      // First click
      await user.click(screen.getByTitle('Delete list'))
      expect(screen.getByText('Delete?')).toBeInTheDocument()

      // Advance timers past the default timeout (3000ms)
      await act(async () => {
        vi.advanceTimersByTime(3100)
      })

      // Should reset to initial state
      await waitFor(() => {
        expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
        expect(screen.getByTitle('Delete list')).toBeInTheDocument()
      })
    })

    it('should hide edit button when in confirmation state', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <SidebarNavItem
          to="/test"
          label="Test Label"
          isCollapsed={false}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />,
        { wrapper: createWrapper() }
      )

      // Initially both buttons should be present
      expect(screen.getByTitle('Edit list')).toBeInTheDocument()
      expect(screen.getByTitle('Delete list')).toBeInTheDocument()

      // First click on delete
      await user.click(screen.getByTitle('Delete list'))

      // Edit button should be hidden during confirmation
      expect(screen.queryByTitle('Edit list')).not.toBeInTheDocument()
      expect(screen.getByTitle('Click again to confirm')).toBeInTheDocument()
    })

    it('should stop propagation on delete click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onDelete = vi.fn()
      const parentClick = vi.fn()

      render(
        <div onClick={parentClick}>
          <SidebarNavItem
            to="/test"
            label="Test Label"
            isCollapsed={false}
            onDelete={onDelete}
          />
        </div>,
        { wrapper: createWrapper() }
      )

      await user.click(screen.getByTitle('Delete list'))

      // Parent click should not be triggered
      expect(parentClick).not.toHaveBeenCalled()
    })
  })

  describe('active state styling', () => {
    it('should apply active styling when route matches', () => {
      render(
        <SidebarNavItem to="/current-path" label="Active Item" isCollapsed={false} />,
        { wrapper: createWrapper(['/current-path']) }
      )

      const link = screen.getByRole('link')
      expect(link).toHaveClass('bg-gray-200')
      expect(link).toHaveClass('font-medium')
    })

    it('should apply inactive styling when route does not match', () => {
      render(
        <SidebarNavItem to="/other-path" label="Inactive Item" isCollapsed={false} />,
        { wrapper: createWrapper(['/current-path']) }
      )

      const link = screen.getByRole('link')
      expect(link).not.toHaveClass('bg-gray-200')
      expect(link).toHaveClass('text-gray-600')
    })
  })
})
