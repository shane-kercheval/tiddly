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
import type { ContentType, HistoryActionType } from '../types'

function renderMetadata(props: {
  beforeMetadata: Record<string, unknown> | null
  afterMetadata: Record<string, unknown> | null
  entityType: ContentType
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

  it('test__argument_key_reordering__does_not_show_false_diff', () => {
    // JSONB round-trips can reorder keys within objects
    const { container } = renderMetadata({
      beforeMetadata: {
        title: 'Test',
        name: 'test',
        tags: [],
        arguments: [{ name: 'arg1', description: 'Desc', required: true }],
      },
      afterMetadata: {
        title: 'Test',
        name: 'test',
        tags: [],
        arguments: [{ required: true, name: 'arg1', description: 'Desc' }],
      },
      entityType: 'prompt',
      action: 'update',
    })

    // Same data, different key order — no changes should be rendered
    expect(container.innerHTML).toBe('')
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

  it('test__handles_missing_field__in_before_metadata', () => {
    // Schema evolution: older records may not have all fields
    renderMetadata({
      beforeMetadata: { title: 'Test', tags: [] },
      afterMetadata: { title: 'Test', tags: [], url: 'https://new.com' },
      entityType: 'bookmark',
      action: 'update',
    })

    // url missing from before → treated as empty → shows change
    expect(screen.getByText('URL:')).toBeInTheDocument()
    expect(screen.getByText('(empty)')).toBeInTheDocument()
    expect(screen.getByText('https://new.com')).toBeInTheDocument()
  })

  it('test__handles_missing_field__in_after_metadata', () => {
    // Defensive: field exists in before but not after
    renderMetadata({
      beforeMetadata: { title: 'Test', tags: [], url: 'https://old.com' },
      afterMetadata: { title: 'Test', tags: [] },
      entityType: 'bookmark',
      action: 'update',
    })

    // url missing from after → treated as empty → shows change
    expect(screen.getByText('URL:')).toBeInTheDocument()
    expect(screen.getByText('https://old.com')).toBeInTheDocument()
    expect(screen.getByText('(empty)')).toBeInTheDocument()
  })

  it('test__treats_null_and_empty_string__as_equivalent', () => {
    // null → "" should not show a false diff
    const { container } = renderMetadata({
      beforeMetadata: { title: null, description: null, tags: [], url: null },
      afterMetadata: { title: '', description: '', tags: [], url: '' },
      entityType: 'bookmark',
      action: 'update',
    })

    expect(container.innerHTML).toBe('')
  })

  it('test__handles_null_tags__gracefully', () => {
    // Tags field is null instead of array — should not crash
    const { container } = renderMetadata({
      beforeMetadata: { title: 'Test', tags: null },
      afterMetadata: { title: 'Test', tags: null },
      entityType: 'note',
      action: 'update',
    })

    // null tags on both sides → treated as empty arrays → no diff
    expect(container.innerHTML).toBe('')
  })

  // --- Tag {id, name} format ---

  it('test__renders_tag_changes__with_new_object_format', () => {
    renderMetadata({
      beforeMetadata: { title: 'Test', tags: [{ id: '1', name: 'old-tag' }] },
      afterMetadata: { title: 'Test', tags: [{ id: '2', name: 'new-tag' }] },
      entityType: 'note',
      action: 'update',
    })

    expect(screen.getByText('- old-tag')).toBeInTheDocument()
    expect(screen.getByText('+ new-tag')).toBeInTheDocument()
  })

  it('test__renders_initial_tags__with_new_object_format', () => {
    renderMetadata({
      beforeMetadata: null,
      afterMetadata: {
        title: 'My Note',
        tags: [{ id: '1', name: 'alpha' }, { id: '2', name: 'beta' }],
      },
      entityType: 'note',
      action: 'create',
    })

    expect(screen.getByText('Tags:')).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
  })

  it('test__tag_object_format_reordering__does_not_show_false_diff', () => {
    const { container } = renderMetadata({
      beforeMetadata: { title: 'Test', tags: [{ id: '2', name: 'b' }, { id: '1', name: 'a' }] },
      afterMetadata: { title: 'Test', tags: [{ id: '1', name: 'a' }, { id: '2', name: 'b' }] },
      entityType: 'note',
      action: 'update',
    })

    expect(container.innerHTML).toBe('')
  })

  // --- Relationship changes ---

  it('test__renders_relationship_additions__as_green_chips', () => {
    renderMetadata({
      beforeMetadata: { title: 'Test', tags: [], relationships: [] },
      afterMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'note', target_id: 'abcd1234-0000', target_title: 'My Note', relationship_type: 'related' },
        ],
      },
      entityType: 'bookmark',
      action: 'update',
    })

    expect(screen.getByText('Links:')).toBeInTheDocument()
    const addedChip = screen.getByText('+ note: My Note')
    expect(addedChip).toBeInTheDocument()
    expect(addedChip.closest('span')).toHaveClass('text-green-700')
  })

  it('test__renders_relationship_removals__as_red_chips', () => {
    renderMetadata({
      beforeMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'prompt', target_id: 'ffff0000-1111', target_title: 'Old Prompt', relationship_type: 'related' },
        ],
      },
      afterMetadata: { title: 'Test', tags: [], relationships: [] },
      entityType: 'bookmark',
      action: 'update',
    })

    const removedChip = screen.getByText('- prompt: Old Prompt')
    expect(removedChip).toBeInTheDocument()
    expect(removedChip.closest('span')).toHaveClass('text-red-700')
  })

  it('test__renders_relationship_additions_and_removals_together', () => {
    renderMetadata({
      beforeMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'note', target_id: '11111111-0000', target_title: 'Old Note', relationship_type: 'related' },
        ],
      },
      afterMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'bookmark', target_id: '22222222-0000', target_title: 'New Bookmark', relationship_type: 'related' },
        ],
      },
      entityType: 'note',
      action: 'update',
    })

    expect(screen.getByText('- note: Old Note')).toBeInTheDocument()
    expect(screen.getByText('+ bookmark: New Bookmark')).toBeInTheDocument()
  })

  it('test__renders_initial_relationships__for_create_v1', () => {
    renderMetadata({
      beforeMetadata: null,
      afterMetadata: {
        title: 'My Note',
        tags: [],
        relationships: [
          { target_type: 'bookmark', target_id: 'aabbccdd-0000', target_title: 'Example Site', relationship_type: 'related' },
        ],
      },
      entityType: 'note',
      action: 'create',
    })

    expect(screen.getByText('Links:')).toBeInTheDocument()
    const chip = screen.getByText('bookmark: Example Site')
    expect(chip).toBeInTheDocument()
    // Initial values use gray styling, no +/- prefix
    expect(chip.closest('span')).toHaveClass('bg-gray-100')
  })

  it('test__relationship_falls_back_to_short_id__when_no_title', () => {
    renderMetadata({
      beforeMetadata: { title: 'Test', tags: [], relationships: [] },
      afterMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'note', target_id: 'abcd1234-0000-0000-0000-000000000000', relationship_type: 'related' },
        ],
      },
      entityType: 'bookmark',
      action: 'update',
    })

    // No target_title → falls back to short ID
    expect(screen.getByText('+ note: abcd1234...')).toBeInTheDocument()
  })

  it('test__relationship_reordering__does_not_show_false_diff', () => {
    const relA = { target_type: 'note', target_id: '11111111-0000', target_title: 'Note A', relationship_type: 'related' }
    const relB = { target_type: 'bookmark', target_id: '22222222-0000', target_title: 'Bookmark B', relationship_type: 'related' }
    const { container } = renderMetadata({
      beforeMetadata: { title: 'Test', tags: [], relationships: [relA, relB] },
      afterMetadata: { title: 'Test', tags: [], relationships: [relB, relA] },
      entityType: 'note',
      action: 'update',
    })

    // Same relationships, different order — no changes should be rendered
    expect(container.innerHTML).toBe('')
  })

  it('test__handles_missing_relationships_field__backward_compat', () => {
    // Older metadata snapshots may not have relationships key at all
    const { container } = renderMetadata({
      beforeMetadata: { title: 'Test', tags: [] },
      afterMetadata: { title: 'Test', tags: [] },
      entityType: 'bookmark',
      action: 'update',
    })

    // Missing on both sides → treated as empty arrays → no diff
    expect(container.innerHTML).toBe('')
  })

  it('test__handles_null_relationships__gracefully', () => {
    const { container } = renderMetadata({
      beforeMetadata: { title: 'Test', tags: [], relationships: null },
      afterMetadata: { title: 'Test', tags: [], relationships: null },
      entityType: 'note',
      action: 'update',
    })

    expect(container.innerHTML).toBe('')
  })

  it('test__relationship_description_change__shows_modified_chip', () => {
    renderMetadata({
      beforeMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'note', target_id: '11111111-0000', target_title: 'My Note', relationship_type: 'related', description: 'Old desc' },
        ],
      },
      afterMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'note', target_id: '11111111-0000', target_title: 'My Note', relationship_type: 'related', description: 'New desc' },
        ],
      },
      entityType: 'bookmark',
      action: 'update',
    })

    // Modified relationship shown with ~ prefix and blue styling
    const chip = screen.getByText(/~ note: My Note/)
    expect(chip).toBeInTheDocument()
    expect(chip.closest('span')).toHaveClass('text-blue-700')
  })

  it('test__relationship_description_added__shows_modified_chip', () => {
    renderMetadata({
      beforeMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'note', target_id: '11111111-0000', target_title: 'My Note', relationship_type: 'related', description: null },
        ],
      },
      afterMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'note', target_id: '11111111-0000', target_title: 'My Note', relationship_type: 'related', description: 'Added desc' },
        ],
      },
      entityType: 'bookmark',
      action: 'update',
    })

    expect(screen.getByText(/~ note: My Note/)).toBeInTheDocument()
  })

  it('test__relationship_description_removed__shows_modified_chip', () => {
    renderMetadata({
      beforeMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'note', target_id: '11111111-0000', target_title: 'My Note', relationship_type: 'related', description: 'Had desc' },
        ],
      },
      afterMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'note', target_id: '11111111-0000', target_title: 'My Note', relationship_type: 'related', description: null },
        ],
      },
      entityType: 'bookmark',
      action: 'update',
    })

    const chip = screen.getByText(/~ note: My Note/)
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveTextContent('no description')
  })

  it('test__relationship_same_description__no_false_diff', () => {
    const rel = { target_type: 'note', target_id: '11111111-0000', target_title: 'My Note', relationship_type: 'related', description: 'Same' }
    const { container } = renderMetadata({
      beforeMetadata: { title: 'Test', tags: [], relationships: [rel] },
      afterMetadata: { title: 'Test', tags: [], relationships: [{ ...rel }] },
      entityType: 'bookmark',
      action: 'update',
    })

    expect(container.innerHTML).toBe('')
  })

  it('test__relationship_mixed_changes__added_removed_modified', () => {
    renderMetadata({
      beforeMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'note', target_id: '11111111-0000', target_title: 'Kept Note', relationship_type: 'related', description: 'Old' },
          { target_type: 'bookmark', target_id: '22222222-0000', target_title: 'Removed BM', relationship_type: 'related' },
        ],
      },
      afterMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'note', target_id: '11111111-0000', target_title: 'Kept Note', relationship_type: 'related', description: 'New' },
          { target_type: 'prompt', target_id: '33333333-0000', target_title: 'Added Prompt', relationship_type: 'related' },
        ],
      },
      entityType: 'bookmark',
      action: 'update',
    })

    // Removed
    expect(screen.getByText('- bookmark: Removed BM')).toBeInTheDocument()
    // Added
    expect(screen.getByText('+ prompt: Added Prompt')).toBeInTheDocument()
    // Modified
    expect(screen.getByText(/~ note: Kept Note/)).toBeInTheDocument()
  })

  it('test__relationships_sorted_by_type_then_title__in_display', () => {
    renderMetadata({
      beforeMetadata: { title: 'Test', tags: [], relationships: [] },
      afterMetadata: {
        title: 'Test',
        tags: [],
        relationships: [
          { target_type: 'prompt', target_id: '33333333-0000', target_title: 'Zebra Prompt', relationship_type: 'related' },
          { target_type: 'bookmark', target_id: '11111111-0000', target_title: 'Alpha Site', relationship_type: 'related' },
          { target_type: 'note', target_id: '22222222-0000', target_title: 'Middle Note', relationship_type: 'related' },
        ],
      },
      entityType: 'note',
      action: 'update',
    })

    // Sorted by type (bookmark, note, prompt) then title within type
    const chips = screen.getAllByText(/^\+/)
    expect(chips).toHaveLength(3)
    expect(chips[0]).toHaveTextContent('+ bookmark: Alpha Site')
    expect(chips[1]).toHaveTextContent('+ note: Middle Note')
    expect(chips[2]).toHaveTextContent('+ prompt: Zebra Prompt')
  })
})
