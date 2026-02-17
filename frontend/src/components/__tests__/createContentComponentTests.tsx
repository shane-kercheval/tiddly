/**
 * Shared test factory for content components (Note, Bookmark, Prompt).
 *
 * These components share common behaviors:
 * - Dirty state detection and Save button enable/disable
 * - Unsaved changes warning dialog integration
 * - Discard confirmation flow (Close -> Discard?)
 * - Keyboard shortcuts (Cmd+S to save, Escape to cancel)
 * - Action buttons (Archive, Restore, Delete)
 * - Read-only mode for deleted items
 *
 * This factory generates tests for all shared behaviors, ensuring
 * consistent coverage across all content types. Each component can
 * add its own specific tests after calling this factory.
 *
 * Note: Validation-dependent tests (like "should disable Save when field cleared")
 * are NOT included here because validation rules differ between components.
 * Those should be tested in component-specific test files.
 *
 * Usage:
 *   createContentComponentTests({
 *     componentName: 'Note',
 *     Component: Note,
 *     mockItem: mockNote,
 *     mockTagSuggestions,
 *     placeholders: { title: 'Note title', ... },
 *     ...
 *   })
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import React from 'react'
import { renderWithRouter } from '../../test-utils'
import type { TagCount } from '../../types'

/**
 * Configuration for content component tests.
 */
export interface ContentComponentTestConfig<TItem, TProps> {
  /** Display name for test descriptions */
  componentName: string

  /** The component under test */
  Component: ComponentType<TProps>

  /** Mock item data for existing item tests */
  mockItem: TItem

  /** Mock item with deleted_at set */
  mockDeletedItem: TItem

  /** Mock item with archived_at set */
  mockArchivedItem: TItem

  /** Tag suggestions for autocomplete */
  mockTagSuggestions: TagCount[]

  /** Placeholder text for finding inputs */
  placeholders: {
    /** Primary editable field (title for Note, Page title for Bookmark, prompt-name for Prompt) */
    primaryField: string
  }

  /** How to get the display value of the primary field from the mock item */
  getPrimaryFieldValue: (item: TItem) => string

  /** Build props for rendering the component */
  buildProps: (overrides: {
    item?: TItem
    onSave: ReturnType<typeof vi.fn>
    onClose: ReturnType<typeof vi.fn>
    onArchive?: ReturnType<typeof vi.fn>
    onUnarchive?: ReturnType<typeof vi.fn>
    onDelete?: ReturnType<typeof vi.fn>
    viewState?: 'active' | 'archived' | 'deleted'
    isSaving?: boolean
  }) => TProps

  /**
   * For components that derive dirty state from props (like Prompt),
   * provide a function to create an updated item after save.
   * If not provided, assumes component manages its own original state.
   */
  createUpdatedItem?: (item: TItem, newPrimaryValue: string) => TItem

  /**
   * Value to use when testing "make form dirty then save" flows.
   * Defaults to "Updated Value". Override for components with strict
   * validation (e.g., Prompt requires lowercase-hyphen format).
   */
  testUpdateValue?: string
}

/**
 * Creates a comprehensive test suite for a content component.
 *
 * This ensures all content types (Note, Bookmark, Prompt) have
 * consistent test coverage for shared behaviors.
 */
export function createContentComponentTests<TItem, TProps>(
  config: ContentComponentTestConfig<TItem, TProps>
): void {
  const {
    componentName,
    Component,
    mockItem,
    mockDeletedItem,
    mockArchivedItem,
    placeholders,
    getPrimaryFieldValue,
    buildProps,
    createUpdatedItem,
    testUpdateValue = 'Updated Value',
  } = config

  // Cast Component to avoid JSX generic type inference issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TypedComponent = Component as React.ComponentType<any>

  describe(`${componentName} component`, () => {
    const mockOnSave = vi.fn()
    const mockOnClose = vi.fn()
    const mockOnArchive = vi.fn()
    const mockOnDelete = vi.fn()
    const mockOnUnarchive = vi.fn()

    beforeEach(() => {
      vi.clearAllMocks()
      localStorage.clear()
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    describe('create mode', () => {
      it('should show Close and Create buttons', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        expect(screen.getByText('Close')).toBeInTheDocument()
        expect(screen.getByText('Create')).toBeInTheDocument()
      })

      it('should show Link content button in create mode', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        expect(screen.getByLabelText('Link content')).toBeInTheDocument()
      })

      it('should allow adding tags when starting with no tags', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        // Tag icon button should be present in create mode
        const addTagButton = screen.getByLabelText('Add tag')
        expect(addTagButton).toBeInTheDocument()

        // Clicking it should mount the tag input (InlineEditableTags must be mounted for this to work)
        await user.click(addTagButton)

        expect(screen.getByPlaceholderText('Add tag...')).toBeInTheDocument()
      })
    })

    describe('edit mode', () => {
      it('should populate form with item data', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        expect(screen.getByDisplayValue(getPrimaryFieldValue(mockItem))).toBeInTheDocument()
      })

      it('should show Close and Save buttons', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        expect(screen.getByText('Close')).toBeInTheDocument()
        expect(screen.getByText('Save')).toBeInTheDocument()
      })
    })

    describe('dirty state', () => {
      it('should show Save button disabled when form is clean', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        const saveButton = screen.getByText('Save').closest('button')
        expect(saveButton).toBeInTheDocument()
        expect(saveButton).toBeDisabled()
      })

      // Note: "should enable Save button when dirty" test is in component-specific
      // tests because validation rules differ (e.g., Prompt requires content)
    })

    describe('discard confirmation', () => {
      it('should close immediately when form is clean', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        await user.click(screen.getByText('Close'))

        expect(mockOnClose).toHaveBeenCalled()
      })

      it('should show Discard? confirmation when form is dirty', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        // Make dirty
        await user.clear(screen.getByDisplayValue(getPrimaryFieldValue(mockItem)))
        await user.type(screen.getByPlaceholderText(placeholders.primaryField), 'Changed')

        // First click shows confirmation
        await user.click(screen.getByText('Close'))
        expect(screen.getByText('Discard?')).toBeInTheDocument()
        expect(mockOnClose).not.toHaveBeenCalled()
      })

      it('should close on second click within confirmation window', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        // Make dirty
        await user.clear(screen.getByDisplayValue(getPrimaryFieldValue(mockItem)))
        await user.type(screen.getByPlaceholderText(placeholders.primaryField), 'Changed')

        // First click
        await user.click(screen.getByText('Close'))
        // Second click
        await user.click(screen.getByText('Discard?'))

        expect(mockOnClose).toHaveBeenCalled()
      })

      it('should reset confirmation after 3 seconds', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        // Make dirty
        await user.clear(screen.getByDisplayValue(getPrimaryFieldValue(mockItem)))
        await user.type(screen.getByPlaceholderText(placeholders.primaryField), 'Changed')

        // First click shows confirmation
        await user.click(screen.getByText('Close'))
        expect(screen.getByText('Discard?')).toBeInTheDocument()

        // Wait 3 seconds - wrap in act() since timer callback updates state
        await act(async () => {
          vi.advanceTimersByTime(3000)
        })

        expect(screen.getByText('Close')).toBeInTheDocument()
      })
    })

    describe('unsaved changes warning integration', () => {
      it('should not show UnsavedChangesDialog when form is clean', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      it('should not show unsaved changes dialog after confirming discard', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        // Make dirty
        await user.clear(screen.getByDisplayValue(getPrimaryFieldValue(mockItem)))
        await user.type(screen.getByPlaceholderText(placeholders.primaryField), 'Changed')

        // First click shows "Discard?" confirmation
        await user.click(screen.getByText('Close'))
        expect(screen.getByText('Discard?')).toBeInTheDocument()

        // Second click confirms discard
        await user.click(screen.getByText('Discard?'))

        expect(mockOnClose).toHaveBeenCalled()
        expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument()
      })

      it('should mark form as clean after saving an existing item', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

        const savePromise = new Promise<void>((resolve) => {
          mockOnSave.mockImplementation(() => {
            resolve()
            return Promise.resolve()
          })
        })

        const { rerender } = renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        // Make a change
        await user.clear(screen.getByDisplayValue(getPrimaryFieldValue(mockItem)))
        await user.type(screen.getByPlaceholderText(placeholders.primaryField), testUpdateValue)

        // Form should be dirty - Save button should be enabled (if valid)
        // Note: We don't assert enabled here because validation differs by component

        // Click Save
        await user.click(screen.getByText('Save'))

        await savePromise

        await waitFor(() => {
          expect(mockOnSave).toHaveBeenCalled()
        })

        // If component derives state from props, simulate parent update
        if (createUpdatedItem) {
          const updatedItem = createUpdatedItem(mockItem, testUpdateValue)
          rerender(
            <TypedComponent
              {...buildProps({
                item: updatedItem,
                onSave: mockOnSave,
                onClose: mockOnClose,
              })}
            />
          )
        }

        // After save, form should be clean
        await waitFor(() => {
          expect(screen.getByText('Save').closest('button')).toBeDisabled()
        })

        // No unsaved changes dialog
        expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument()
      })
    })

    describe('keyboard shortcuts', () => {
      it('should start discard confirmation on Escape when dirty', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        await user.clear(screen.getByDisplayValue(getPrimaryFieldValue(mockItem)))
        await user.type(screen.getByPlaceholderText(placeholders.primaryField), 'Changed')

        fireEvent.keyDown(document, { key: 'Escape' })

        expect(screen.getByText('Discard?')).toBeInTheDocument()
      })

      it('should close on Enter when confirming discard', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        // Make the form dirty
        await user.clear(screen.getByDisplayValue(getPrimaryFieldValue(mockItem)))
        await user.type(screen.getByPlaceholderText(placeholders.primaryField), 'Changed')

        // Press Escape to start discard confirmation
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.getByText('Discard?')).toBeInTheDocument()

        // Press Enter to confirm discard
        fireEvent.keyDown(document, { key: 'Enter' })

        // Should close without showing unsaved changes dialog
        expect(mockOnClose).toHaveBeenCalled()
        expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument()
      })

      it('should close on Escape when form is clean', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        fireEvent.keyDown(document, { key: 'Escape' })

        expect(mockOnClose).toHaveBeenCalled()
      })

      it('should not save on Cmd+S when form is not dirty', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        // Press Cmd+S without making any changes
        fireEvent.keyDown(document, { key: 's', metaKey: true })

        // onSave should not be called when form is not dirty
        expect(mockOnSave).not.toHaveBeenCalled()
      })

      it('should save on Cmd+S when form is dirty', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        // Make the form dirty (use lowercase-with-hyphens to work for Prompt name validation)
        await user.clear(screen.getByDisplayValue(getPrimaryFieldValue(mockItem)))
        await user.type(screen.getByPlaceholderText(placeholders.primaryField), 'changed-value')

        // Press Cmd+S
        fireEvent.keyDown(document, { key: 's', metaKey: true })

        // onSave should be called when form is dirty
        await waitFor(() => {
          expect(mockOnSave).toHaveBeenCalled()
        })
      })

      it('should save and close on Cmd+Shift+S when form is dirty', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        mockOnSave.mockResolvedValue(undefined)

        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        // Make the form dirty (use lowercase-with-hyphens to work for Prompt name validation)
        await user.clear(screen.getByDisplayValue(getPrimaryFieldValue(mockItem)))
        await user.type(screen.getByPlaceholderText(placeholders.primaryField), 'changed-value')

        // Press Cmd+Shift+S
        fireEvent.keyDown(document, { key: 's', metaKey: true, shiftKey: true })

        // onSave should be called
        await waitFor(() => {
          expect(mockOnSave).toHaveBeenCalled()
        })

        // onClose should be called after save completes
        await waitFor(() => {
          expect(mockOnClose).toHaveBeenCalled()
        })
      })

      it('should NOT save and close on Cmd+Shift+S when form is not dirty', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        // Press Cmd+Shift+S without making any changes
        fireEvent.keyDown(document, { key: 's', metaKey: true, shiftKey: true })

        // onSave should not be called when form is not dirty
        expect(mockOnSave).not.toHaveBeenCalled()
        expect(mockOnClose).not.toHaveBeenCalled()
      })
    })

    describe('saving state', () => {
      it('should show page-level spinner overlay when isSaving is true', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
              isSaving: true,
            })}
          />
        )

        // Should show page-level loading spinner
        expect(screen.getByRole('status')).toBeInTheDocument()
        expect(screen.getByText('Saving...')).toBeInTheDocument()
      })

      it('should NOT show page-level spinner overlay when isSaving is false', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
              isSaving: false,
            })}
          />
        )

        // Should not show page-level loading spinner
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
      })
    })

    describe('action buttons', () => {
      it('should show Archive button for active items', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
              onArchive: mockOnArchive,
              viewState: 'active',
            })}
          />
        )

        expect(screen.getByText('Archive')).toBeInTheDocument()
      })

      it('should show Restore button for archived items', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockArchivedItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
              onUnarchive: mockOnUnarchive,
              viewState: 'archived',
            })}
          />
        )

        expect(screen.getByText('Restore')).toBeInTheDocument()
      })

      it('should show Delete button', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
              onDelete: mockOnDelete,
            })}
          />
        )

        expect(screen.getByText('Delete')).toBeInTheDocument()
      })

      it('should call onArchive when Archive is clicked', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
              onArchive: mockOnArchive,
              viewState: 'active',
            })}
          />
        )

        await user.click(screen.getByText('Archive'))

        expect(mockOnArchive).toHaveBeenCalled()
      })
    })

    describe('quick-create linked buttons', () => {
      it('should show quick-create buttons after opening link search in edit mode', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        // Buttons hidden before opening link search
        expect(screen.queryByLabelText('Create linked note')).not.toBeInTheDocument()

        // Open the link search widget
        await user.click(screen.getByLabelText('Link content'))

        expect(screen.getByLabelText('Create linked note')).toBeInTheDocument()
        expect(screen.getByLabelText('Create linked bookmark')).toBeInTheDocument()
        expect(screen.getByLabelText('Create linked prompt')).toBeInTheDocument()
      })

      it('should not show quick-create buttons in create mode even after opening link search', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              onSave: mockOnSave,
              onClose: mockOnClose,
            })}
          />
        )

        await user.click(screen.getByLabelText('Link content'))

        expect(screen.queryByLabelText('Create linked note')).not.toBeInTheDocument()
        expect(screen.queryByLabelText('Create linked bookmark')).not.toBeInTheDocument()
        expect(screen.queryByLabelText('Create linked prompt')).not.toBeInTheDocument()
      })
    })

    describe('read-only mode', () => {
      it('should disable primary field for deleted items', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockDeletedItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
              viewState: 'deleted',
            })}
          />
        )

        expect(screen.getByDisplayValue(getPrimaryFieldValue(mockDeletedItem))).toBeDisabled()
      })

      it('should show read-only banner for deleted items', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockDeletedItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
              viewState: 'deleted',
            })}
          />
        )

        expect(screen.getByText(/in trash and cannot be edited/)).toBeInTheDocument()
      })

      it('should NOT disable fields for archived items', () => {
        renderWithRouter(
          <TypedComponent
            {...buildProps({
              item: mockArchivedItem,
              onSave: mockOnSave,
              onClose: mockOnClose,
              viewState: 'archived',
            })}
          />
        )

        expect(screen.getByDisplayValue(getPrimaryFieldValue(mockArchivedItem))).not.toBeDisabled()
      })
    })
  })
}
