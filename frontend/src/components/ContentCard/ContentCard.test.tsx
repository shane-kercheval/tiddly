/**
 * Tests for ContentCard compound component.
 */
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ContentCard,
  useContentCardContext,
  ContentCardFooter,
  ContentCardTags,
  ContentCardDateDisplay,
  ContentCardActions,
  ContentCardScheduledArchive,
  AddTagAction,
  ArchiveAction,
  RestoreAction,
  DeleteAction,
} from './index'
import type { ContentCardView } from './index'

// Test component that uses context
function ContextConsumer(): ReactNode {
  const { view } = useContentCardContext()
  return <span data-testid="view-value">{view}</span>
}

describe('ContentCard', () => {
  describe('rendering', () => {
    it('should render children', () => {
      render(
        <ContentCard>
          <span>Test Content</span>
        </ContentCard>
      )

      expect(screen.getByText('Test Content')).toBeInTheDocument()
    })

    it('should apply card classes', () => {
      const { container } = render(
        <ContentCard>
          <span>Content</span>
        </ContentCard>
      )

      const card = container.querySelector('.card')
      expect(card).toBeInTheDocument()
      expect(card).toHaveClass('card-interactive')
      expect(card).toHaveClass('group')
    })

    it('should apply custom className', () => {
      const { container } = render(
        <ContentCard className="custom-class">
          <span>Content</span>
        </ContentCard>
      )

      const card = container.querySelector('.card')
      expect(card).toHaveClass('custom-class')
    })
  })

  describe('click behavior', () => {
    it('should apply cursor-pointer when onClick is provided', () => {
      const { container } = render(
        <ContentCard onClick={vi.fn()}>
          <span>Content</span>
        </ContentCard>
      )

      const card = container.querySelector('.card')
      expect(card).toHaveClass('cursor-pointer')
    })

    it('should not apply cursor-pointer when onClick is not provided', () => {
      const { container } = render(
        <ContentCard>
          <span>Content</span>
        </ContentCard>
      )

      const card = container.querySelector('.card')
      expect(card).not.toHaveClass('cursor-pointer')
    })

    it('should call onClick when card is clicked', async () => {
      const onClick = vi.fn()
      const user = userEvent.setup()

      const { container } = render(
        <ContentCard onClick={onClick}>
          <span>Content</span>
        </ContentCard>
      )

      const card = container.querySelector('.card')
      await user.click(card!)

      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('context', () => {
    it('should provide default view as active', () => {
      render(
        <ContentCard>
          <ContextConsumer />
        </ContentCard>
      )

      expect(screen.getByTestId('view-value')).toHaveTextContent('active')
    })

    it.each<ContentCardView>(['active', 'archived', 'deleted'])(
      'should provide view=%s to children',
      (view) => {
        render(
          <ContentCard view={view}>
            <ContextConsumer />
          </ContentCard>
        )

        expect(screen.getByTestId('view-value')).toHaveTextContent(view)
      }
    )

    it('should throw error when useContentCardContext is used outside ContentCard', () => {
      // Suppress console.error for this test since React will log the error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        render(<ContextConsumer />)
      }).toThrow('ContentCard subcomponents must be used within ContentCard')

      consoleSpy.mockRestore()
    })
  })

  describe('static properties', () => {
    it('should have Footer attached as static property', () => {
      expect(ContentCard.Footer).toBe(ContentCardFooter)
    })

    it('should have Tags attached as static property', () => {
      expect(ContentCard.Tags).toBe(ContentCardTags)
    })

    it('should have DateDisplay attached as static property', () => {
      expect(ContentCard.DateDisplay).toBe(ContentCardDateDisplay)
    })

    it('should have Actions attached as static property', () => {
      expect(ContentCard.Actions).toBe(ContentCardActions)
    })

    it('should have ScheduledArchive attached as static property', () => {
      expect(ContentCard.ScheduledArchive).toBe(ContentCardScheduledArchive)
    })

    it('should have AddTagAction attached as static property', () => {
      expect(ContentCard.AddTagAction).toBe(AddTagAction)
    })

    it('should have ArchiveAction attached as static property', () => {
      expect(ContentCard.ArchiveAction).toBe(ArchiveAction)
    })

    it('should have RestoreAction attached as static property', () => {
      expect(ContentCard.RestoreAction).toBe(RestoreAction)
    })

    it('should have DeleteAction attached as static property', () => {
      expect(ContentCard.DeleteAction).toBe(DeleteAction)
    })
  })
})

describe('ContentCardFooter', () => {
  it('should render children', () => {
    render(
      <ContentCardFooter>
        <span>Footer Content</span>
      </ContentCardFooter>
    )

    expect(screen.getByText('Footer Content')).toBeInTheDocument()
  })

  it('should have md:contents class for responsive behavior', () => {
    const { container } = render(
      <ContentCardFooter>
        <span>Content</span>
      </ContentCardFooter>
    )

    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('md:contents')
  })

  it('should have flex column layout on mobile', () => {
    const { container } = render(
      <ContentCardFooter>
        <span>Content</span>
      </ContentCardFooter>
    )

    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('flex')
    expect(wrapper).toHaveClass('flex-col')
    expect(wrapper).toHaveClass('gap-2')
  })
})

describe('ContentCardTags', () => {
  it('should render tags', () => {
    render(<ContentCardTags tags={['react', 'typescript']} />)

    expect(screen.getByText('react')).toBeInTheDocument()
    expect(screen.getByText('typescript')).toBeInTheDocument()
  })

  it('should return null when tags array is empty', () => {
    const { container } = render(<ContentCardTags tags={[]} />)

    expect(container.firstChild).toBeNull()
  })

  it('should call onTagClick when a tag is clicked', async () => {
    const onTagClick = vi.fn()
    const user = userEvent.setup()

    render(<ContentCardTags tags={['react']} onTagClick={onTagClick} />)

    await user.click(screen.getByRole('button', { name: 'react' }))

    expect(onTagClick).toHaveBeenCalledWith('react')
  })

  it('should call onTagRemove when tag remove button is clicked', async () => {
    const onTagRemove = vi.fn()
    const user = userEvent.setup()

    render(<ContentCardTags tags={['react']} onTagRemove={onTagRemove} />)

    await user.click(screen.getByRole('button', { name: /remove tag react/i }))

    expect(onTagRemove).toHaveBeenCalledWith('react')
  })

  it('should have correct responsive classes', () => {
    const { container } = render(<ContentCardTags tags={['react']} />)

    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('flex')
    expect(wrapper).toHaveClass('flex-wrap')
    expect(wrapper).toHaveClass('gap-1')
    expect(wrapper).toHaveClass('md:justify-end')
    expect(wrapper).toHaveClass('md:w-32')
    expect(wrapper).toHaveClass('md:shrink-0')
  })
})

describe('ContentCardDateDisplay', () => {
  const baseDates = {
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    lastUsedAt: '2024-01-03T00:00:00Z',
    archivedAt: '2024-01-04T00:00:00Z',
    deletedAt: '2024-01-05T00:00:00Z',
  }

  it('should show created date by default', () => {
    render(<ContentCardDateDisplay sortBy="created_at" {...baseDates} />)

    expect(screen.getByText(/Created:/)).toBeInTheDocument()
  })

  it('should show created date for title sort', () => {
    render(<ContentCardDateDisplay sortBy="title" {...baseDates} />)

    expect(screen.getByText(/Created:/)).toBeInTheDocument()
  })

  it('should show modified date when sortBy is updated_at', () => {
    render(<ContentCardDateDisplay sortBy="updated_at" {...baseDates} />)

    expect(screen.getByText(/Modified:/)).toBeInTheDocument()
  })

  it('should show used date when sortBy is last_used_at', () => {
    render(<ContentCardDateDisplay sortBy="last_used_at" {...baseDates} />)

    expect(screen.getByText(/Used:/)).toBeInTheDocument()
  })

  it('should show archived date when sortBy is archived_at', () => {
    render(<ContentCardDateDisplay sortBy="archived_at" {...baseDates} />)

    expect(screen.getByText(/Archived:/)).toBeInTheDocument()
  })

  it('should show deleted date when sortBy is deleted_at', () => {
    render(<ContentCardDateDisplay sortBy="deleted_at" {...baseDates} />)

    expect(screen.getByText(/Deleted:/)).toBeInTheDocument()
  })

  it('should apply correct styling', () => {
    const { container } = render(<ContentCardDateDisplay sortBy="created_at" {...baseDates} />)

    const span = container.firstChild
    expect(span).toHaveClass('text-xs')
    expect(span).toHaveClass('text-gray-400')
  })
})

describe('ContentCardActions', () => {
  it('should render children', () => {
    render(
      <ContentCardActions>
        <button>Action</button>
      </ContentCardActions>
    )

    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
  })

  it('should render meta when provided', () => {
    render(
      <ContentCardActions meta={<span>Meta content</span>}>
        <button>Action</button>
      </ContentCardActions>
    )

    expect(screen.getByText('Meta content')).toBeInTheDocument()
  })

  it('should not render meta container when meta is not provided', () => {
    const { container } = render(
      <ContentCardActions>
        <button>Action</button>
      </ContentCardActions>
    )

    // Should only have one child div (the actions container)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.children).toHaveLength(1)
  })

  it('should have correct responsive classes', () => {
    const { container } = render(
      <ContentCardActions>
        <button>Action</button>
      </ContentCardActions>
    )

    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('flex')
    expect(wrapper).toHaveClass('items-center')
    expect(wrapper).toHaveClass('justify-between')
    expect(wrapper).toHaveClass('w-full')
    expect(wrapper).toHaveClass('md:w-auto')
    expect(wrapper).toHaveClass('md:flex-col')
    expect(wrapper).toHaveClass('md:items-end')
    expect(wrapper).toHaveClass('md:shrink-0')
  })
})

describe('AddTagAction', () => {
  const mockSuggestions = [
    { name: 'react', content_count: 5, filter_count: 0 },
    { name: 'typescript', content_count: 3, filter_count: 0 },
  ]

  it('should render AddTagButton', () => {
    render(
      <AddTagAction
        existingTags={['test']}
        suggestions={mockSuggestions}
        onAdd={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument()
  })
})

describe('ArchiveAction', () => {
  it('should render in active view', () => {
    render(
      <ContentCard view="active">
        <ArchiveAction onArchive={vi.fn()} entityName="note" />
      </ContentCard>
    )

    expect(screen.getByRole('button', { name: 'Archive note' })).toBeInTheDocument()
  })

  it('should not render in archived view', () => {
    render(
      <ContentCard view="archived">
        <ArchiveAction onArchive={vi.fn()} entityName="note" />
      </ContentCard>
    )

    expect(screen.queryByRole('button', { name: 'Archive note' })).not.toBeInTheDocument()
  })

  it('should not render in deleted view', () => {
    render(
      <ContentCard view="deleted">
        <ArchiveAction onArchive={vi.fn()} entityName="note" />
      </ContentCard>
    )

    expect(screen.queryByRole('button', { name: 'Archive note' })).not.toBeInTheDocument()
  })

  it('should call onArchive when clicked', async () => {
    const onArchive = vi.fn()
    const user = userEvent.setup()

    render(
      <ContentCard view="active">
        <ArchiveAction onArchive={onArchive} entityName="note" />
      </ContentCard>
    )

    await user.click(screen.getByRole('button', { name: 'Archive note' }))

    expect(onArchive).toHaveBeenCalledTimes(1)
  })

  it('should use entityName in aria-label', () => {
    render(
      <ContentCard view="active">
        <ArchiveAction onArchive={vi.fn()} entityName="bookmark" />
      </ContentCard>
    )

    expect(screen.getByRole('button', { name: 'Archive bookmark' })).toBeInTheDocument()
  })
})

describe('RestoreAction', () => {
  it('should render (does not check view)', () => {
    render(
      <ContentCard view="active">
        <RestoreAction onRestore={vi.fn()} entityName="note" />
      </ContentCard>
    )

    expect(screen.getByRole('button', { name: 'Restore note' })).toBeInTheDocument()
  })

  it('should call onRestore when clicked', async () => {
    const onRestore = vi.fn()
    const user = userEvent.setup()

    render(
      <ContentCard view="deleted">
        <RestoreAction onRestore={onRestore} entityName="note" />
      </ContentCard>
    )

    await user.click(screen.getByRole('button', { name: 'Restore note' }))

    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('should use entityName in aria-label', () => {
    render(
      <ContentCard view="archived">
        <RestoreAction onRestore={vi.fn()} entityName="prompt" />
      </ContentCard>
    )

    expect(screen.getByRole('button', { name: 'Restore prompt' })).toBeInTheDocument()
  })
})

describe('DeleteAction', () => {
  it('should render soft delete button in active view', () => {
    render(
      <ContentCard view="active">
        <DeleteAction onDelete={vi.fn()} entityName="note" />
      </ContentCard>
    )

    expect(screen.getByRole('button', { name: 'Delete note' })).toBeInTheDocument()
  })

  it('should render soft delete button in archived view', () => {
    render(
      <ContentCard view="archived">
        <DeleteAction onDelete={vi.fn()} entityName="note" />
      </ContentCard>
    )

    expect(screen.getByRole('button', { name: 'Delete note' })).toBeInTheDocument()
  })

  it('should render ConfirmDeleteButton in deleted view', () => {
    render(
      <ContentCard view="deleted">
        <DeleteAction onDelete={vi.fn()} entityName="note" />
      </ContentCard>
    )

    // ConfirmDeleteButton has "Delete permanently" aria-label
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeInTheDocument()
  })

  it('should call onDelete when soft delete is clicked', async () => {
    const onDelete = vi.fn()
    const user = userEvent.setup()

    render(
      <ContentCard view="active">
        <DeleteAction onDelete={onDelete} entityName="note" />
      </ContentCard>
    )

    await user.click(screen.getByRole('button', { name: 'Delete note' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('should use entityName in aria-label for soft delete', () => {
    render(
      <ContentCard view="active">
        <DeleteAction onDelete={vi.fn()} entityName="bookmark" />
      </ContentCard>
    )

    expect(screen.getByRole('button', { name: 'Delete bookmark' })).toBeInTheDocument()
  })

  it('should have danger styling for soft delete', () => {
    render(
      <ContentCard view="active">
        <DeleteAction onDelete={vi.fn()} entityName="note" />
      </ContentCard>
    )

    const button = screen.getByRole('button', { name: 'Delete note' })
    expect(button).toHaveClass('btn-icon-danger')
  })
})

describe('ContentCardScheduledArchive', () => {
  // Helper to get a future date
  const getFutureDate = (): string => {
    const date = new Date()
    date.setDate(date.getDate() + 7) // 7 days from now
    return date.toISOString()
  }

  // Helper to get a past date
  const getPastDate = (): string => {
    const date = new Date()
    date.setDate(date.getDate() - 7) // 7 days ago
    return date.toISOString()
  }

  it('should render when archivedAt is in the future and view is active', () => {
    render(
      <ContentCard view="active">
        <ContentCardScheduledArchive archivedAt={getFutureDate()} />
      </ContentCard>
    )

    expect(screen.getByText(/Archiving:/)).toBeInTheDocument()
  })

  it('should not render when archivedAt is null', () => {
    render(
      <ContentCard view="active">
        <ContentCardScheduledArchive archivedAt={null} />
      </ContentCard>
    )

    expect(screen.queryByText(/Archiving:/)).not.toBeInTheDocument()
  })

  it('should not render when archivedAt is in the past', () => {
    render(
      <ContentCard view="active">
        <ContentCardScheduledArchive archivedAt={getPastDate()} />
      </ContentCard>
    )

    expect(screen.queryByText(/Archiving:/)).not.toBeInTheDocument()
  })

  it('should not render in archived view', () => {
    render(
      <ContentCard view="archived">
        <ContentCardScheduledArchive archivedAt={getFutureDate()} />
      </ContentCard>
    )

    expect(screen.queryByText(/Archiving:/)).not.toBeInTheDocument()
  })

  it('should not render in deleted view', () => {
    render(
      <ContentCard view="deleted">
        <ContentCardScheduledArchive archivedAt={getFutureDate()} />
      </ContentCard>
    )

    expect(screen.queryByText(/Archiving:/)).not.toBeInTheDocument()
  })

  it('should show cancel button when onCancel is provided', () => {
    render(
      <ContentCard view="active">
        <ContentCardScheduledArchive archivedAt={getFutureDate()} onCancel={vi.fn()} />
      </ContentCard>
    )

    expect(screen.getByRole('button', { name: 'Cancel scheduled archive' })).toBeInTheDocument()
  })

  it('should not show cancel button when onCancel is not provided', () => {
    render(
      <ContentCard view="active">
        <ContentCardScheduledArchive archivedAt={getFutureDate()} />
      </ContentCard>
    )

    expect(screen.queryByRole('button', { name: 'Cancel scheduled archive' })).not.toBeInTheDocument()
  })

  it('should call onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()

    render(
      <ContentCard view="active">
        <ContentCardScheduledArchive archivedAt={getFutureDate()} onCancel={onCancel} />
      </ContentCard>
    )

    await user.click(screen.getByRole('button', { name: 'Cancel scheduled archive' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should have amber warning styling', () => {
    const { container } = render(
      <ContentCard view="active">
        <ContentCardScheduledArchive archivedAt={getFutureDate()} />
      </ContentCard>
    )

    const wrapper = container.querySelector('.text-amber-600')
    expect(wrapper).toBeInTheDocument()
  })
})
