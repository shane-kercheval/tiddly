/**
 * Tests for SidebarGroup component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidebarGroup } from './SidebarGroup'

describe('SidebarGroup', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic rendering', () => {
    it('should render the group name', () => {
      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      expect(screen.getByText('Test Group')).toBeInTheDocument()
    })

    it('should render children when expanded', () => {
      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
        >
          <div data-testid="child-content">Child content</div>
        </SidebarGroup>
      )

      expect(screen.getByTestId('child-content')).toBeInTheDocument()
    })

    it('should NOT render children when group is collapsed', () => {
      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={true}
          onToggle={vi.fn()}
        >
          <div data-testid="child-content">Child content</div>
        </SidebarGroup>
      )

      expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
    })

    it('should render icon when sidebar is collapsed', () => {
      render(
        <SidebarGroup
          name="Test Group"
          icon={<span data-testid="group-icon">Icon</span>}
          isCollapsed={true}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      expect(screen.getByTestId('group-icon')).toBeInTheDocument()
    })

    it('should render button when sidebar is collapsed', () => {
      render(
        <SidebarGroup
          name="Test Group"
          icon={<span>Icon</span>}
          isCollapsed={true}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('toggle behavior', () => {
    it('should call onToggle when header is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onToggle = vi.fn()

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={onToggle}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      await user.click(screen.getByRole('button'))
      expect(onToggle).toHaveBeenCalledTimes(1)
    })

    it('should show expanded chevron when group is expanded', () => {
      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      // The chevron SVG should have rotate-90 class when expanded
      const chevron = document.querySelector('svg')
      expect(chevron).toHaveClass('rotate-90')
    })

    it('should show collapsed chevron when group is collapsed', () => {
      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={true}
          onToggle={vi.fn()}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      const chevron = document.querySelector('svg')
      expect(chevron).not.toHaveClass('rotate-90')
    })
  })

  describe('inline rename', () => {
    it('should show edit button when onRename is provided', () => {
      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onRename={vi.fn()}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      expect(screen.getByRole('button', { name: 'Rename group' })).toBeInTheDocument()
    })

    it('should enter edit mode when edit button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onRename={vi.fn()}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      await user.click(screen.getByRole('button', { name: 'Rename group' }))

      // Input should appear with the current name
      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('Test Group')
    })

    it('should call onRename with new name when Enter is pressed', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onRename = vi.fn()

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onRename={onRename}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      await user.click(screen.getByRole('button', { name: 'Rename group' }))

      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.type(input, 'New Name{Enter}')

      expect(onRename).toHaveBeenCalledWith('New Name')
    })

    it('should call onRename with new name when input loses focus', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onRename = vi.fn()

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onRename={onRename}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      await user.click(screen.getByRole('button', { name: 'Rename group' }))

      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.type(input, 'New Name')
      await user.tab() // Blur the input

      expect(onRename).toHaveBeenCalledWith('New Name')
    })

    it('should cancel rename and restore original name on Escape', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onRename = vi.fn()

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onRename={onRename}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      await user.click(screen.getByRole('button', { name: 'Rename group' }))

      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.type(input, 'New Name{Escape}')

      // Should NOT call onRename
      expect(onRename).not.toHaveBeenCalled()

      // Should exit edit mode and show original name
      await waitFor(() => {
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
        expect(screen.getByText('Test Group')).toBeInTheDocument()
      })
    })

    it('should NOT call onRename if name is empty', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onRename = vi.fn()

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onRename={onRename}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      await user.click(screen.getByRole('button', { name: 'Rename group' }))

      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.type(input, '{Enter}')

      expect(onRename).not.toHaveBeenCalled()
    })

    it('should NOT call onRename if name is unchanged', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onRename = vi.fn()

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onRename={onRename}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      await user.click(screen.getByRole('button', { name: 'Rename group' }))

      const input = screen.getByRole('textbox')
      await user.type(input, '{Enter}')

      expect(onRename).not.toHaveBeenCalled()
    })

    it('should trim whitespace from new name', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onRename = vi.fn()

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onRename={onRename}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      await user.click(screen.getByRole('button', { name: 'Rename group' }))

      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.type(input, '  New Name  {Enter}')

      expect(onRename).toHaveBeenCalledWith('New Name')
    })
  })

  describe('two-click delete confirmation', () => {
    it('should show delete button when onDelete is provided', () => {
      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onDelete={vi.fn()}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      expect(screen.getByRole('button', { name: 'Delete group' })).toBeInTheDocument()
    })

    it('should show confirmation state on first click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onDelete = vi.fn()

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onDelete={onDelete}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      await user.click(screen.getByRole('button', { name: 'Delete group' }))

      expect(screen.getByText('Delete?')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Click again to confirm' })).toBeInTheDocument()
      expect(onDelete).not.toHaveBeenCalled()
    })

    it('should call onDelete on second click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onDelete = vi.fn()

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onDelete={onDelete}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      await user.click(screen.getByRole('button', { name: 'Delete group' }))
      await user.click(screen.getByRole('button', { name: 'Click again to confirm' }))

      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('should reset confirmation after timeout', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onDelete = vi.fn()

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onDelete={onDelete}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      await user.click(screen.getByRole('button', { name: 'Delete group' }))
      expect(screen.getByText('Delete?')).toBeInTheDocument()

      await act(async () => {
        vi.advanceTimersByTime(3100)
      })

      await waitFor(() => {
        expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Delete group' })).toBeInTheDocument()
      })
    })

    it('should hide edit button when in confirmation state', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      expect(screen.getByRole('button', { name: 'Rename group' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Delete group' }))

      expect(screen.queryByRole('button', { name: 'Rename group' })).not.toBeInTheDocument()
    })
  })

  describe('action buttons visibility', () => {
    it('should NOT show action buttons when sidebar is collapsed', () => {
      render(
        <SidebarGroup
          name="Test Group"
          icon={<span>Icon</span>}
          isCollapsed={true}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      expect(screen.queryByRole('button', { name: 'Rename group' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Delete group' })).not.toBeInTheDocument()
    })

    it('should NOT show action buttons when in edit mode', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      await user.click(screen.getByRole('button', { name: 'Rename group' }))

      // Should be in edit mode now
      expect(screen.getByRole('textbox')).toBeInTheDocument()

      // Action buttons should be hidden
      expect(screen.queryByRole('button', { name: 'Rename group' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Delete group' })).not.toBeInTheDocument()
    })
  })

  describe('stop propagation', () => {
    it('should stop propagation on delete click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onDelete = vi.fn()
      const parentClick = vi.fn()

      render(
        <div onClick={parentClick}>
          <SidebarGroup
            name="Test Group"
            isCollapsed={false}
            isGroupCollapsed={false}
            onToggle={vi.fn()}
            onDelete={onDelete}
          >
            <div>Child content</div>
          </SidebarGroup>
        </div>
      )

      await user.click(screen.getByRole('button', { name: 'Delete group' }))

      expect(parentClick).not.toHaveBeenCalled()
    })

    it('should stop propagation on edit button click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const parentClick = vi.fn()

      render(
        <div onClick={parentClick}>
          <SidebarGroup
            name="Test Group"
            isCollapsed={false}
            isGroupCollapsed={false}
            onToggle={vi.fn()}
            onRename={vi.fn()}
          >
            <div>Child content</div>
          </SidebarGroup>
        </div>
      )

      await user.click(screen.getByRole('button', { name: 'Rename group' }))

      expect(parentClick).not.toHaveBeenCalled()
    })

    it('should stop propagation on input click (to prevent toggle)', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onToggle = vi.fn()

      render(
        <SidebarGroup
          name="Test Group"
          isCollapsed={false}
          isGroupCollapsed={false}
          onToggle={onToggle}
          onRename={vi.fn()}
        >
          <div>Child content</div>
        </SidebarGroup>
      )

      // Enter edit mode
      await user.click(screen.getByRole('button', { name: 'Rename group' }))
      onToggle.mockClear()

      // Click on input
      await user.click(screen.getByRole('textbox'))

      // Should not have toggled the group
      expect(onToggle).not.toHaveBeenCalled()
    })
  })
})
