/**
 * Tests for MetadataChanges component.
 *
 * Covers: unchanged metadata, CREATE initial values, pruned predecessor,
 * field-by-field changes (title, url, name, description, tags, arguments),
 * entity type field visibility.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetadataChanges } from './MetadataChanges'
import type { HistoryEntityType, HistoryActionType } from '../types'

function renderMetadata(props: {
  beforeMetadata: Record<string, unknown> | null
  afterMetadata: Record<string, unknown> | null
  entityType: HistoryEntityType
  action: HistoryActionType
}): ReturnType<typeof render> {
  return render(<MetadataChanges {...props} />)
}

describe('MetadataChanges', () => {
  it('test__renders_nothing__when_metadata_unchanged', () => {
    const metadata = { title: 'Test', tags: ['a', 'b'] }
    const { container } = renderMetadata({
      beforeMetadata: metadata,
      afterMetadata: metadata,
      entityType: 'bookmark',
      action: 'update',
    })
    expect(container.innerHTML).toBe('')
  })

  it('test__renders_nothing__when_both_metadata_are_null', () => {
    const { container } = renderMetadata({
      beforeMetadata: null,
      afterMetadata: null,
      entityType: 'bookmark',
      action: 'update',
    })
    expect(container.innerHTML).toBe('')
  })

  it('test__renders_initial_values__for_create_v1', () => {
    renderMetadata({
      beforeMetadata: null,
      afterMetadata: {
        title: 'My Bookmark',
        url: 'https://example.com',
        description: '',
        tags: ['tag1', 'tag2'],
      },
      entityType: 'bookmark',
      action: 'create',
    })

    // Non-empty fields shown
    expect(screen.getByText('Title:')).toBeInTheDocument()
    expect(screen.getByText('My Bookmark')).toBeInTheDocument()
    expect(screen.getByText('URL:')).toBeInTheDocument()
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
    expect(screen.getByText('Tags:')).toBeInTheDocument()
    expect(screen.getByText('tag1')).toBeInTheDocument()
    expect(screen.getByText('tag2')).toBeInTheDocument()

    // Empty description not shown
    expect(screen.queryByText('Description:')).not.toBeInTheDocument()
  })

  it('test__renders_title_change__with_arrow_notation', () => {
    renderMetadata({
      beforeMetadata: { title: 'Old Title', tags: [] },
      afterMetadata: { title: 'New Title', tags: [] },
      entityType: 'note',
      action: 'update',
    })

    expect(screen.getByText('Title:')).toBeInTheDocument()
    expect(screen.getByText('Old Title')).toBeInTheDocument()
    expect(screen.getByText('New Title')).toBeInTheDocument()
  })

  it('test__renders_url_change__with_arrow_notation', () => {
    renderMetadata({
      beforeMetadata: { title: 'Test', url: 'https://old.com', tags: [] },
      afterMetadata: { title: 'Test', url: 'https://new.com', tags: [] },
      entityType: 'bookmark',
      action: 'update',
    })

    expect(screen.getByText('URL:')).toBeInTheDocument()
    expect(screen.getByText('https://old.com')).toBeInTheDocument()
    expect(screen.getByText('https://new.com')).toBeInTheDocument()
  })

  it('test__renders_name_change__with_arrow_notation', () => {
    renderMetadata({
      beforeMetadata: { title: 'Test', name: 'old-prompt', tags: [], arguments: [] },
      afterMetadata: { title: 'Test', name: 'new-prompt', tags: [], arguments: [] },
      entityType: 'prompt',
      action: 'update',
    })

    expect(screen.getByText('Name:')).toBeInTheDocument()
    expect(screen.getByText('old-prompt')).toBeInTheDocument()
    expect(screen.getByText('new-prompt')).toBeInTheDocument()
  })

  it('test__renders_empty_to_nonempty__with_empty_label', () => {
    renderMetadata({
      beforeMetadata: { title: '', tags: [] },
      afterMetadata: { title: 'Now has a title', tags: [] },
      entityType: 'note',
      action: 'update',
    })

    expect(screen.getByText('(empty)')).toBeInTheDocument()
    expect(screen.getByText('Now has a title')).toBeInTheDocument()
  })

  it('test__renders_tag_additions__as_green_chips', () => {
    renderMetadata({
      beforeMetadata: { title: 'Test', tags: ['existing'] },
      afterMetadata: { title: 'Test', tags: ['existing', 'new-tag'] },
      entityType: 'bookmark',
      action: 'update',
    })

    expect(screen.getByText('Tags:')).toBeInTheDocument()
    const addedChip = screen.getByText('+ new-tag')
    expect(addedChip).toBeInTheDocument()
    expect(addedChip.closest('span')).toHaveClass('text-green-700')
  })

  it('test__renders_tag_removals__as_red_chips', () => {
    renderMetadata({
      beforeMetadata: { title: 'Test', tags: ['keep', 'remove-me'] },
      afterMetadata: { title: 'Test', tags: ['keep'] },
      entityType: 'bookmark',
      action: 'update',
    })

    const removedChip = screen.getByText('- remove-me')
    expect(removedChip).toBeInTheDocument()
    expect(removedChip.closest('span')).toHaveClass('text-red-700')
  })

  it('test__renders_tag_additions_and_removals_together', () => {
    renderMetadata({
      beforeMetadata: { title: 'Test', tags: ['old-tag'] },
      afterMetadata: { title: 'Test', tags: ['new-tag'] },
      entityType: 'note',
      action: 'update',
    })

    expect(screen.getByText('- old-tag')).toBeInTheDocument()
    expect(screen.getByText('+ new-tag')).toBeInTheDocument()
  })

  it('test__renders_arguments_changed_message', () => {
    renderMetadata({
      beforeMetadata: {
        title: 'Test',
        name: 'test',
        tags: [],
        arguments: [{ name: 'old_arg', description: null, required: false }],
      },
      afterMetadata: {
        title: 'Test',
        name: 'test',
        tags: [],
        arguments: [{ name: 'new_arg', description: 'New arg', required: true }],
      },
      entityType: 'prompt',
      action: 'update',
    })

    expect(screen.getByText('Arguments:')).toBeInTheDocument()
    expect(screen.getByText('Arguments changed')).toBeInTheDocument()
  })

  it('test__skips_unchanged_fields', () => {
    renderMetadata({
      beforeMetadata: { title: 'Changed', description: 'Same', tags: ['same'], url: 'https://same.com' },
      afterMetadata: { title: 'New Title', description: 'Same', tags: ['same'], url: 'https://same.com' },
      entityType: 'bookmark',
      action: 'update',
    })

    // Only title changed
    expect(screen.getByText('Title:')).toBeInTheDocument()
    expect(screen.queryByText('Description:')).not.toBeInTheDocument()
    expect(screen.queryByText('Tags:')).not.toBeInTheDocument()
    expect(screen.queryByText('URL:')).not.toBeInTheDocument()
  })

  it('test__renders_description_change__with_diff_view', () => {
    renderMetadata({
      beforeMetadata: { title: 'Test', description: 'Old description', tags: [] },
      afterMetadata: { title: 'Test', description: 'New description', tags: [] },
      entityType: 'note',
      action: 'update',
    })

    expect(screen.getByText('Description:')).toBeInTheDocument()
    // DiffView component is rendered (mocked in test environment)
    expect(screen.getByTestId('diff-viewer')).toBeInTheDocument()
  })

  it('test__respects_entity_type__bookmark_shows_url_not_name', () => {
    renderMetadata({
      beforeMetadata: { title: 'Test', tags: [], url: 'https://old.com' },
      afterMetadata: { title: 'Test', tags: [], url: 'https://new.com' },
      entityType: 'bookmark',
      action: 'update',
    })

    expect(screen.getByText('URL:')).toBeInTheDocument()
    // name/arguments not relevant for bookmarks
    expect(screen.queryByText('Name:')).not.toBeInTheDocument()
    expect(screen.queryByText('Arguments:')).not.toBeInTheDocument()
  })

  it('test__respects_entity_type__note_hides_url_and_name', () => {
    // Even if url/name exist in metadata, note entity type shouldn't show them
    renderMetadata({
      beforeMetadata: { title: 'Old', tags: [], url: 'https://old.com', name: 'old' },
      afterMetadata: { title: 'New', tags: [], url: 'https://new.com', name: 'new' },
      entityType: 'note',
      action: 'update',
    })

    expect(screen.getByText('Title:')).toBeInTheDocument()
    expect(screen.queryByText('URL:')).not.toBeInTheDocument()
    expect(screen.queryByText('Name:')).not.toBeInTheDocument()
  })

  it('test__respects_entity_type__prompt_shows_name_and_arguments', () => {
    renderMetadata({
      beforeMetadata: { title: 'Test', name: 'old-name', tags: [], arguments: [] },
      afterMetadata: { title: 'Test', name: 'new-name', tags: [], arguments: [] },
      entityType: 'prompt',
      action: 'update',
    })

    expect(screen.getByText('Name:')).toBeInTheDocument()
    expect(screen.queryByText('URL:')).not.toBeInTheDocument()
  })

  it('test__renders_pruned_predecessor_message', () => {
    renderMetadata({
      beforeMetadata: null,
      afterMetadata: { title: 'Test', tags: [] },
      entityType: 'bookmark',
      action: 'update',
    })

    expect(screen.getByText('Previous metadata unavailable')).toBeInTheDocument()
  })

  it('test__create_v1__skips_empty_fields', () => {
    renderMetadata({
      beforeMetadata: null,
      afterMetadata: {
        title: '',
        description: null,
        tags: [],
        url: '',
      },
      entityType: 'bookmark',
      action: 'create',
    })

    // All fields empty — nothing to show, so component returns null
    const { container } = render(
      <MetadataChanges
        beforeMetadata={null}
        afterMetadata={{ title: '', description: null, tags: [], url: '' }}
        entityType="bookmark"
        action="create"
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('test__create_v1__shows_arguments_count_for_prompt', () => {
    renderMetadata({
      beforeMetadata: null,
      afterMetadata: {
        title: 'My Prompt',
        name: 'my-prompt',
        tags: [],
        arguments: [
          { name: 'arg1', description: null, required: true },
          { name: 'arg2', description: null, required: false },
        ],
      },
      entityType: 'prompt',
      action: 'create',
    })

    expect(screen.getByText('Arguments:')).toBeInTheDocument()
    expect(screen.getByText('2 arguments defined')).toBeInTheDocument()
  })

  it('test__tag_reordering__does_not_show_false_diff', () => {
    const { container } = renderMetadata({
      beforeMetadata: { title: 'Test', tags: ['b', 'a', 'c'] },
      afterMetadata: { title: 'Test', tags: ['c', 'a', 'b'] },
      entityType: 'note',
      action: 'update',
    })

    // Same tags, different order — no changes should be rendered
    expect(container.innerHTML).toBe('')
  })
})
