import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterModal } from './FilterModal'
import type { ContentFilter, TagCount } from '../types'

const mockSuggestions: TagCount[] = [
  { name: 'react', count: 5 },
  { name: 'typescript', count: 3 },
  { name: 'javascript', count: 8 },
]

const mockFilter: ContentFilter = {
  id: '1',
  name: 'Work Resources',
  content_types: ['bookmark'],
  filter_expression: {
    groups: [{ tags: ['work', 'resources'], operator: 'AND' }],
    group_operator: 'OR',
  },
  default_sort_by: null,
  default_sort_ascending: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

describe('FilterModal', () => {
  describe('rendering', () => {
    it('should not render when closed', () => {
      render(
        <FilterModal
          isOpen={false}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      expect(screen.queryByText('Create Filter')).not.toBeInTheDocument()
    })

    it('should render create mode when no filter provided', () => {
      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      expect(screen.getByRole('heading', { name: 'Create Filter' })).toBeInTheDocument()
      expect(screen.getByLabelText('Filter Name')).toHaveValue('')
    })

    it('should render edit mode with populated form when filter provided', () => {
      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          filter={mockFilter}
          tagSuggestions={mockSuggestions}
        />
      )

      expect(screen.getByText('Edit Filter')).toBeInTheDocument()
      expect(screen.getByLabelText('Filter Name')).toHaveValue('Work Resources')
      expect(screen.getByText('work')).toBeInTheDocument()
      expect(screen.getByText('resources')).toBeInTheDocument()
    })
  })

  describe('validation', () => {
    it('should allow submitting without tag filters', async () => {
      const onCreate = vi.fn().mockResolvedValue({ id: 1 })
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
          onCreate={onCreate}
        />
      )

      // Enter a name but no tags
      const nameInput = screen.getByLabelText('Filter Name')
      await user.type(nameInput, 'My Filter')

      const submitButton = screen.getByRole('button', { name: 'Create Filter' })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith({
          name: 'My Filter',
          content_types: ['bookmark', 'note'],
          filter_expression: {
            groups: [],
            group_operator: 'OR',
          },
          default_sort_by: null,
          default_sort_ascending: null,
        })
      })
    })

    it('should disable submit button when name is empty', () => {
      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
          onCreate={vi.fn()}
        />
      )

      const submitButton = screen.getByRole('button', { name: 'Create Filter' })
      expect(submitButton).toBeDisabled()
    })
  })

  describe('form submission', () => {
    it('should call onCreate with trimmed name and cleaned expression', async () => {
      const onCreate = vi.fn().mockResolvedValue({ id: 1, name: 'Test', filter_expression: {}, created_at: '', updated_at: '' })
      const onClose = vi.fn()
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={onClose}
          tagSuggestions={mockSuggestions}
          onCreate={onCreate}
        />
      )

      // Enter name with extra whitespace
      const nameInput = screen.getByLabelText('Filter Name')
      await user.type(nameInput, '  My New Filter  ')

      // Add a tag and wait for it to appear
      const tagInput = screen.getByPlaceholderText('Add tag...')
      await user.type(tagInput, 'react{Enter}')

      // Wait for tag to be added before submitting
      await waitFor(() => {
        expect(screen.getByText('react')).toBeInTheDocument()
      })

      // Submit
      const submitButton = screen.getByRole('button', { name: 'Create Filter' })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith({
          name: 'My New Filter',
          content_types: ['bookmark', 'note'],  // Default to all types
          filter_expression: {
            groups: [{ tags: ['react'], operator: 'AND' }],
            group_operator: 'OR',
          },
          default_sort_by: null,
          default_sort_ascending: null,
        })
      })

      expect(onClose).toHaveBeenCalled()
    })

    it('should call onUpdate when editing existing filter', async () => {
      const onUpdate = vi.fn().mockResolvedValue(mockFilter)
      const onClose = vi.fn()
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={onClose}
          filter={mockFilter}
          tagSuggestions={mockSuggestions}
          onUpdate={onUpdate}
        />
      )

      // Change the name
      const nameInput = screen.getByLabelText('Filter Name')
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Name')

      // Submit
      const submitButton = screen.getByText('Save')
      await user.click(submitButton)

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith('1', {
          name: 'Updated Name',
          content_types: mockFilter.content_types,
          filter_expression: mockFilter.filter_expression,
          default_sort_by: null,
          default_sort_ascending: null,
        })
      })

      expect(onClose).toHaveBeenCalled()
    })

    it('should clean up empty groups before submitting', async () => {
      const onCreate = vi.fn().mockResolvedValue({ id: 1, name: 'Test', filter_expression: {}, created_at: '', updated_at: '' })
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
          onCreate={onCreate}
        />
      )

      // Enter name
      const nameInput = screen.getByLabelText('Filter Name')
      await user.type(nameInput, 'Test Filter')

      // Add a tag to first group
      const tagInput = screen.getByPlaceholderText('Add tag...')
      await user.type(tagInput, 'react{Enter}')

      // Wait for tag to be added before continuing
      await waitFor(() => {
        expect(screen.getByText('react')).toBeInTheDocument()
      })

      // Add an OR group (will be empty)
      const addGroupButton = screen.getByText('Add OR group')
      await user.click(addGroupButton)

      // Submit - empty group should be cleaned up
      const submitButton = screen.getByRole('button', { name: 'Create Filter' })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith({
          name: 'Test Filter',
          content_types: ['bookmark', 'note'],
          filter_expression: {
            groups: [{ tags: ['react'], operator: 'AND' }],
            group_operator: 'OR',
          },
          default_sort_by: null,
          default_sort_ascending: null,
        })
      })
    })

    it('should show error message when submission fails', async () => {
      const onCreate = vi.fn().mockRejectedValue(new Error('Network error'))
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
          onCreate={onCreate}
        />
      )

      const nameInput = screen.getByLabelText('Filter Name')
      await user.type(nameInput, 'Test Filter')

      const tagInput = screen.getByPlaceholderText('Add tag...')
      await user.type(tagInput, 'react{Enter}')

      // Wait for tag to be added before continuing
      await waitFor(() => {
        expect(screen.getByText('react')).toBeInTheDocument()
      })

      const submitButton = screen.getByRole('button', { name: 'Create Filter' })
      await user.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })
  })

  describe('modal interactions', () => {
    it('should close when clicking Cancel', async () => {
      const onClose = vi.fn()
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={onClose}
          tagSuggestions={mockSuggestions}
        />
      )

      const cancelButton = screen.getByText('Cancel')
      await user.click(cancelButton)

      expect(onClose).toHaveBeenCalled()
    })

    it('should NOT close when clicking backdrop (prevents accidental data loss)', async () => {
      const onClose = vi.fn()
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={onClose}
          tagSuggestions={mockSuggestions}
        />
      )

      // Click the backdrop (the modal-backdrop overlay)
      const backdrop = document.querySelector('.modal-backdrop')
      expect(backdrop).toBeTruthy()
      await user.click(backdrop!)

      // Modal should NOT close on backdrop click
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should close when clicking close button', async () => {
      const onClose = vi.fn()
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={onClose}
          tagSuggestions={mockSuggestions}
        />
      )

      // Find the close button (X icon in header)
      const closeButtons = screen.getAllByRole('button')
      const closeButton = closeButtons.find(btn => btn.querySelector('svg'))
      expect(closeButton).toBeTruthy()
      await user.click(closeButton!)

      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('sort configuration', () => {
    it('should render sort dropdown with system default selected', () => {
      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      const sortDropdown = screen.getByLabelText('Default Sort')
      expect(sortDropdown).toBeInTheDocument()
      expect(sortDropdown).toHaveValue('')
      expect(screen.getByText('System default (Last Used)')).toBeInTheDocument()
    })

    it('should show all base sort options in dropdown', () => {
      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      const sortDropdown = screen.getByLabelText('Default Sort')

      // Check all sort options are present
      expect(sortDropdown.querySelector('option[value="last_used_at"]')).toBeInTheDocument()
      expect(sortDropdown.querySelector('option[value="created_at"]')).toBeInTheDocument()
      expect(sortDropdown.querySelector('option[value="updated_at"]')).toBeInTheDocument()
      expect(sortDropdown.querySelector('option[value="title"]')).toBeInTheDocument()
    })

    it('should not show ascending checkbox when system default is selected', () => {
      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      expect(screen.queryByLabelText('Ascending')).not.toBeInTheDocument()
    })

    it('should show ascending checkbox when sort option is selected', async () => {
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      const sortDropdown = screen.getByLabelText('Default Sort')
      await user.selectOptions(sortDropdown, 'title')

      expect(screen.getByLabelText('Ascending')).toBeInTheDocument()
    })

    it('should hide ascending checkbox when switching back to system default', async () => {
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      const sortDropdown = screen.getByLabelText('Default Sort')

      // Select a sort option
      await user.selectOptions(sortDropdown, 'title')
      expect(screen.getByLabelText('Ascending')).toBeInTheDocument()

      // Switch back to system default
      await user.selectOptions(sortDropdown, '')
      expect(screen.queryByLabelText('Ascending')).not.toBeInTheDocument()
    })

    it('should submit with custom sort configuration', async () => {
      const onCreate = vi.fn().mockResolvedValue({
        id: 1,
        name: 'Test',
        filter_expression: {},
        default_sort_by: 'title',
        default_sort_ascending: true,
        created_at: '',
        updated_at: '',
      })
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
          onCreate={onCreate}
        />
      )

      // Enter name
      const nameInput = screen.getByLabelText('Filter Name')
      await user.type(nameInput, 'Sorted Filter')

      // Add a tag
      const tagInput = screen.getByPlaceholderText('Add tag...')
      await user.type(tagInput, 'react{Enter}')
      await waitFor(() => {
        expect(screen.getByText('react')).toBeInTheDocument()
      })

      // Select sort option
      const sortDropdown = screen.getByLabelText('Default Sort')
      await user.selectOptions(sortDropdown, 'title')

      // Check ascending
      const ascendingCheckbox = screen.getByLabelText('Ascending')
      await user.click(ascendingCheckbox)

      // Submit
      const submitButton = screen.getByRole('button', { name: 'Create Filter' })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith({
          name: 'Sorted Filter',
          content_types: ['bookmark', 'note'],
          filter_expression: {
            groups: [{ tags: ['react'], operator: 'AND' }],
            group_operator: 'OR',
          },
          default_sort_by: 'title',
          default_sort_ascending: true,
        })
      })
    })

    it('should submit with sort by only (ascending false)', async () => {
      const onCreate = vi.fn().mockResolvedValue({
        id: 1,
        name: 'Test',
        filter_expression: {},
        default_sort_by: 'created_at',
        default_sort_ascending: false,
        created_at: '',
        updated_at: '',
      })
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
          onCreate={onCreate}
        />
      )

      // Enter name
      await user.type(screen.getByLabelText('Filter Name'), 'My Filter')

      // Add a tag
      await user.type(screen.getByPlaceholderText('Add tag...'), 'test{Enter}')
      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument()
      })

      // Select sort option (don't check ascending)
      await user.selectOptions(screen.getByLabelText('Default Sort'), 'created_at')

      // Submit
      await user.click(screen.getByRole('button', { name: 'Create Filter' }))

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            default_sort_by: 'created_at',
            default_sort_ascending: false,
          })
        )
      })
    })

    it('should pre-populate sort config when editing filter with sort', async () => {
      const filterWithSort: ContentFilter = {
        ...mockFilter,
        default_sort_by: 'created_at',
        default_sort_ascending: true,
      }

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          filter={filterWithSort}
          tagSuggestions={mockSuggestions}
        />
      )

      // Sort dropdown should have the value
      const sortDropdown = screen.getByLabelText('Default Sort')
      expect(sortDropdown).toHaveValue('created_at')

      // Ascending checkbox should be visible and checked
      const ascendingCheckbox = screen.getByLabelText('Ascending')
      expect(ascendingCheckbox).toBeInTheDocument()
      expect(ascendingCheckbox).toBeChecked()
    })

    it('should pre-populate sort config with ascending false', () => {
      const filterWithSort: ContentFilter = {
        ...mockFilter,
        default_sort_by: 'title',
        default_sort_ascending: false,
      }

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          filter={filterWithSort}
          tagSuggestions={mockSuggestions}
        />
      )

      const sortDropdown = screen.getByLabelText('Default Sort')
      expect(sortDropdown).toHaveValue('title')

      const ascendingCheckbox = screen.getByLabelText('Ascending')
      expect(ascendingCheckbox).not.toBeChecked()
    })

    it('should update existing filter with new sort config', async () => {
      const onUpdate = vi.fn().mockResolvedValue(mockFilter)
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          filter={mockFilter}
          tagSuggestions={mockSuggestions}
          onUpdate={onUpdate}
        />
      )

      // Change sort config
      const sortDropdown = screen.getByLabelText('Default Sort')
      await user.selectOptions(sortDropdown, 'updated_at')

      const ascendingCheckbox = screen.getByLabelText('Ascending')
      await user.click(ascendingCheckbox)

      // Submit
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith('1', {
          name: 'Work Resources',
          content_types: mockFilter.content_types,
          filter_expression: mockFilter.filter_expression,
          default_sort_by: 'updated_at',
          default_sort_ascending: true,
        })
      })
    })

    it('should clear sort config when changing to system default', async () => {
      const filterWithSort: ContentFilter = {
        ...mockFilter,
        default_sort_by: 'title',
        default_sort_ascending: true,
      }
      const onUpdate = vi.fn().mockResolvedValue(mockFilter)
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          filter={filterWithSort}
          tagSuggestions={mockSuggestions}
          onUpdate={onUpdate}
        />
      )

      // Change to system default
      const sortDropdown = screen.getByLabelText('Default Sort')
      await user.selectOptions(sortDropdown, '')

      // Submit
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith('1', {
          name: 'Work Resources',
          content_types: filterWithSort.content_types,
          filter_expression: mockFilter.filter_expression,
          default_sort_by: null,
          default_sort_ascending: null,
        })
      })
    })
  })

  describe('content types configuration', () => {
    it('should render content types checkboxes', () => {
      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      expect(screen.getByText('Content Types')).toBeInTheDocument()
      expect(screen.getByLabelText('Bookmarks')).toBeInTheDocument()
      expect(screen.getByLabelText('Notes')).toBeInTheDocument()
      expect(screen.getByLabelText('Prompts')).toBeInTheDocument()
    })

    it('should default to Bookmarks and Notes checked for new filter', () => {
      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      expect(screen.getByLabelText('Bookmarks')).toBeChecked()
      expect(screen.getByLabelText('Notes')).toBeChecked()
      expect(screen.getByLabelText('Prompts')).not.toBeChecked()
    })

    it('should populate content types from existing filter', () => {
      const bookmarkOnlyFilter: ContentFilter = {
        ...mockFilter,
        content_types: ['bookmark'],
      }

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          filter={bookmarkOnlyFilter}
          tagSuggestions={mockSuggestions}
        />
      )

      expect(screen.getByLabelText('Bookmarks')).toBeChecked()
      expect(screen.getByLabelText('Notes')).not.toBeChecked()
      expect(screen.getByLabelText('Prompts')).not.toBeChecked()
    })

    it('should populate content types for prompt-only filter', () => {
      const promptOnlyFilter: ContentFilter = {
        ...mockFilter,
        content_types: ['prompt'],
      }

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          filter={promptOnlyFilter}
          tagSuggestions={mockSuggestions}
        />
      )

      expect(screen.getByLabelText('Bookmarks')).not.toBeChecked()
      expect(screen.getByLabelText('Notes')).not.toBeChecked()
      expect(screen.getByLabelText('Prompts')).toBeChecked()
    })

    it('should allow toggling content types', async () => {
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      // Bookmarks and Notes checked by default, Prompts unchecked
      expect(screen.getByLabelText('Bookmarks')).toBeChecked()
      expect(screen.getByLabelText('Notes')).toBeChecked()
      expect(screen.getByLabelText('Prompts')).not.toBeChecked()

      // Check Prompts
      await user.click(screen.getByLabelText('Prompts'))
      expect(screen.getByLabelText('Prompts')).toBeChecked()

      // Uncheck Notes
      await user.click(screen.getByLabelText('Notes'))
      expect(screen.getByLabelText('Notes')).not.toBeChecked()

      // Bookmarks and Prompts should still be checked
      expect(screen.getByLabelText('Bookmarks')).toBeChecked()
      expect(screen.getByLabelText('Prompts')).toBeChecked()
    })

    it('should not allow unchecking the last content type', async () => {
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      // Uncheck Notes first
      await user.click(screen.getByLabelText('Notes'))
      expect(screen.getByLabelText('Notes')).not.toBeChecked()

      // Try to uncheck Bookmarks - should be disabled
      const bookmarksCheckbox = screen.getByLabelText('Bookmarks')
      expect(bookmarksCheckbox).toBeDisabled()
    })

    it('should not allow unchecking last content type when only Prompts is checked', async () => {
      const promptOnlyFilter: ContentFilter = {
        ...mockFilter,
        content_types: ['prompt'],
      }

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          filter={promptOnlyFilter}
          tagSuggestions={mockSuggestions}
        />
      )

      // Prompts should be checked and disabled (can't uncheck last type)
      const promptsCheckbox = screen.getByLabelText('Prompts')
      expect(promptsCheckbox).toBeChecked()
      expect(promptsCheckbox).toBeDisabled()
    })

    it('should submit with modified content types', async () => {
      const onCreate = vi.fn().mockResolvedValue({
        id: 1,
        name: 'Test',
        content_types: ['bookmark'],
        filter_expression: {},
        created_at: '',
        updated_at: '',
      })
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
          onCreate={onCreate}
        />
      )

      // Enter name
      await user.type(screen.getByLabelText('Filter Name'), 'Bookmarks Only')

      // Add a tag
      await user.type(screen.getByPlaceholderText('Add tag...'), 'test{Enter}')
      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument()
      })

      // Uncheck Notes
      await user.click(screen.getByLabelText('Notes'))

      // Submit
      await user.click(screen.getByRole('button', { name: 'Create Filter' }))

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith({
          name: 'Bookmarks Only',
          content_types: ['bookmark'],
          filter_expression: {
            groups: [{ tags: ['test'], operator: 'AND' }],
            group_operator: 'OR',
          },
          default_sort_by: null,
          default_sort_ascending: null,
        })
      })
    })

    it('should update filter with modified content types', async () => {
      const onUpdate = vi.fn().mockResolvedValue(mockFilter)
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          filter={mockFilter}
          tagSuggestions={mockSuggestions}
          onUpdate={onUpdate}
        />
      )

      // Check Notes (mockFilter has only bookmark)
      await user.click(screen.getByLabelText('Notes'))

      // Submit
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith('1', {
          name: 'Work Resources',
          content_types: ['bookmark', 'note'],
          filter_expression: mockFilter.filter_expression,
          default_sort_by: null,
          default_sort_ascending: null,
        })
      })
    })

    it('should submit with prompts-only content type', async () => {
      const onCreate = vi.fn().mockResolvedValue({
        id: 1,
        name: 'Test',
        content_types: ['prompt'],
        filter_expression: {},
        created_at: '',
        updated_at: '',
      })
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
          onCreate={onCreate}
        />
      )

      // Enter name
      await user.type(screen.getByLabelText('Filter Name'), 'Prompts Only')

      // Uncheck Bookmarks and Notes, check Prompts
      await user.click(screen.getByLabelText('Prompts'))
      await user.click(screen.getByLabelText('Bookmarks'))
      await user.click(screen.getByLabelText('Notes'))

      // Submit
      await user.click(screen.getByRole('button', { name: 'Create Filter' }))

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith({
          name: 'Prompts Only',
          content_types: ['prompt'],
          filter_expression: {
            groups: [],
            group_operator: 'OR',
          },
          default_sort_by: null,
          default_sort_ascending: null,
        })
      })
    })

    it('should submit with all three content types', async () => {
      const onCreate = vi.fn().mockResolvedValue({
        id: 1,
        name: 'Test',
        content_types: ['bookmark', 'note', 'prompt'],
        filter_expression: {},
        created_at: '',
        updated_at: '',
      })
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          tagSuggestions={mockSuggestions}
          onCreate={onCreate}
        />
      )

      // Enter name
      await user.type(screen.getByLabelText('Filter Name'), 'Everything')

      // Check Prompts (Bookmarks and Notes already checked by default)
      await user.click(screen.getByLabelText('Prompts'))

      // Submit
      await user.click(screen.getByRole('button', { name: 'Create Filter' }))

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith({
          name: 'Everything',
          content_types: ['bookmark', 'note', 'prompt'],
          filter_expression: {
            groups: [],
            group_operator: 'OR',
          },
          default_sort_by: null,
          default_sort_ascending: null,
        })
      })
    })

    it('should update filter to add prompts content type', async () => {
      const onUpdate = vi.fn().mockResolvedValue(mockFilter)
      const user = userEvent.setup()

      render(
        <FilterModal
          isOpen={true}
          onClose={vi.fn()}
          filter={mockFilter}
          tagSuggestions={mockSuggestions}
          onUpdate={onUpdate}
        />
      )

      // Check Prompts (mockFilter has only bookmark)
      await user.click(screen.getByLabelText('Prompts'))

      // Submit
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith('1', {
          name: 'Work Resources',
          content_types: ['bookmark', 'prompt'],
          filter_expression: mockFilter.filter_expression,
          default_sort_by: null,
          default_sort_ascending: null,
        })
      })
    })
  })
})
