import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRelationshipState } from './useRelationshipState'
import type { ContentListItem, RelationshipInputPayload } from '../types'
import type { LinkedItem } from '../utils/relationships'

/** Helper to build a minimal RelationshipInputPayload */
function rel(type: 'bookmark' | 'note' | 'prompt', id: string): RelationshipInputPayload {
  return { target_type: type, target_id: id, relationship_type: 'related' }
}

/** Helper to build a LinkedItem for the cache */
function linked(type: 'bookmark' | 'note' | 'prompt', id: string, title: string | null, promptName: string | null = null): LinkedItem {
  return { relationshipId: '', type, id, title, url: null, promptName, deleted: false, archived: false, description: null }
}

interface TestState { relationships: RelationshipInputPayload[] }

function renderRelationshipState(params: {
  currentRelationships: RelationshipInputPayload[]
  initialLinkedItems?: LinkedItem[]
}): ReturnType<typeof renderHook<ReturnType<typeof useRelationshipState>, unknown>> {
  const setCurrent = vi.fn()
  return renderHook(() =>
    useRelationshipState<TestState>({
      contentType: 'note',
      entityId: 'note-1',
      serverRelationships: undefined,
      currentRelationships: params.currentRelationships,
      setCurrent,
      initialLinkedItems: params.initialLinkedItems,
    })
  )
}

describe('useRelationshipState', () => {
  describe('linkedItems sorting', () => {
    it('should sort by type: bookmarks before notes before prompts', () => {
      const { result } = renderRelationshipState({
        currentRelationships: [rel('prompt', 'p1'), rel('note', 'n1'), rel('bookmark', 'b1')],
        initialLinkedItems: [
          linked('prompt', 'p1', 'Prompt A'),
          linked('note', 'n1', 'Note A'),
          linked('bookmark', 'b1', 'Bookmark A'),
        ],
      })

      expect(result.current.linkedItems.map((i) => i.type)).toEqual(['bookmark', 'note', 'prompt'])
    })

    it('should sort alphabetically within the same type', () => {
      const { result } = renderRelationshipState({
        currentRelationships: [rel('note', 'n2'), rel('note', 'n1'), rel('note', 'n3')],
        initialLinkedItems: [
          linked('note', 'n2', 'Zebra'),
          linked('note', 'n1', 'Apple'),
          linked('note', 'n3', 'Mango'),
        ],
      })

      expect(result.current.linkedItems.map((i) => i.title)).toEqual(['Apple', 'Mango', 'Zebra'])
    })

    it('should sort null titles after non-null titles', () => {
      const { result } = renderRelationshipState({
        currentRelationships: [rel('note', 'n1'), rel('note', 'n2'), rel('note', 'n3')],
        initialLinkedItems: [
          linked('note', 'n1', null),
          linked('note', 'n2', 'Beta'),
          linked('note', 'n3', 'Alpha'),
        ],
      })

      expect(result.current.linkedItems.map((i) => i.title)).toEqual(['Alpha', 'Beta', null])
    })

    it('should handle mixed types and titles correctly', () => {
      const { result } = renderRelationshipState({
        currentRelationships: [
          rel('prompt', 'p1'), rel('bookmark', 'b2'), rel('note', 'n1'),
          rel('bookmark', 'b1'), rel('note', 'n2'), rel('prompt', 'p2'),
        ],
        initialLinkedItems: [
          linked('prompt', 'p1', 'Zulu'),
          linked('bookmark', 'b2', 'Beta'),
          linked('note', 'n1', null),
          linked('bookmark', 'b1', 'Alpha'),
          linked('note', 'n2', 'Charlie'),
          linked('prompt', 'p2', 'Alpha'),
        ],
      })

      const items = result.current.linkedItems
      // Bookmarks first (Alpha, Beta), then Notes (Charlie, null), then Prompts (Alpha, Zulu)
      expect(items.map((i) => `${i.type}:${i.title}`)).toEqual([
        'bookmark:Alpha', 'bookmark:Beta',
        'note:Charlie', 'note:null',
        'prompt:Alpha', 'prompt:Zulu',
      ])
    })

    it('should sort prompts by promptName when title is null', () => {
      const { result } = renderRelationshipState({
        currentRelationships: [rel('prompt', 'p1'), rel('prompt', 'p2'), rel('prompt', 'p3')],
        initialLinkedItems: [
          linked('prompt', 'p1', null, 'zulu-prompt'),
          linked('prompt', 'p2', null, 'alpha-prompt'),
          linked('prompt', 'p3', 'Beta Title'),
        ],
      })

      const items = result.current.linkedItems
      // 'Beta Title' sorts between alpha-prompt and zulu-prompt
      expect(items.map((i) => i.title ?? i.promptName)).toEqual([
        'alpha-prompt', 'Beta Title', 'zulu-prompt',
      ])
    })

    it('should return empty array when no relationships', () => {
      const { result } = renderRelationshipState({
        currentRelationships: [],
      })

      expect(result.current.linkedItems).toEqual([])
    })
  })

  describe('handleAddRelationship', () => {
    it('should add item to cache and call setCurrent', () => {
      const setCurrent = vi.fn()
      const { result } = renderHook(() =>
        useRelationshipState<TestState>({
          contentType: 'note',
          entityId: 'note-1',
          serverRelationships: undefined,
          currentRelationships: [],
          setCurrent,
        })
      )

      act(() => {
        result.current.handleAddRelationship({
          id: 'b1', type: 'bookmark', title: 'New Bookmark', url: 'https://example.com',
          deleted_at: null, archived_at: null,
        } as ContentListItem)
      })

      expect(setCurrent).toHaveBeenCalledOnce()
    })

    it('should cache promptName from ContentListItem.name for prompts', () => {
      const setCurrent = vi.fn()
      const { result, rerender } = renderHook(
        ({ rels }: { rels: RelationshipInputPayload[] }) =>
          useRelationshipState<TestState>({
            contentType: 'note',
            entityId: 'note-1',
            serverRelationships: undefined,
            currentRelationships: rels,
            setCurrent,
          }),
        { initialProps: { rels: [] as RelationshipInputPayload[] } },
      )

      act(() => {
        result.current.handleAddRelationship({
          id: 'p1', type: 'prompt', title: null, url: null, name: 'my-prompt',
          deleted_at: null, archived_at: null,
        } as ContentListItem)
      })

      // Re-render with the new relationship so linkedItems picks up the cache
      rerender({ rels: [rel('prompt', 'p1')] })

      expect(result.current.linkedItems[0].promptName).toBe('my-prompt')
    })
  })

  describe('handleRemoveRelationship', () => {
    it('should call setCurrent to filter out the item', () => {
      const setCurrent = vi.fn()
      const { result } = renderHook(() =>
        useRelationshipState<TestState>({
          contentType: 'note',
          entityId: 'note-1',
          serverRelationships: undefined,
          currentRelationships: [rel('bookmark', 'b1')],
          setCurrent,
        })
      )

      act(() => {
        result.current.handleRemoveRelationship(linked('bookmark', 'b1', 'Test'))
      })

      expect(setCurrent).toHaveBeenCalledOnce()
      // Verify the updater function filters correctly
      const updater = setCurrent.mock.calls[0][0] as (prev: TestState) => TestState
      const newState = updater({ relationships: [rel('bookmark', 'b1'), rel('note', 'n1')] })
      expect(newState.relationships).toEqual([rel('note', 'n1')])
    })
  })

  describe('initialLinkedItems', () => {
    it('should seed cache so items render with title', () => {
      const { result } = renderRelationshipState({
        currentRelationships: [rel('bookmark', 'b1')],
        initialLinkedItems: [linked('bookmark', 'b1', 'Seeded Title')],
      })

      expect(result.current.linkedItems[0].title).toBe('Seeded Title')
    })

    it('should fall back to null title when no cache entry exists', () => {
      const { result } = renderRelationshipState({
        currentRelationships: [rel('bookmark', 'b1')],
      })

      expect(result.current.linkedItems[0].title).toBeNull()
    })

    it('should fall back to null promptName when no cache entry exists', () => {
      const { result } = renderRelationshipState({
        currentRelationships: [rel('prompt', 'p1')],
      })

      expect(result.current.linkedItems[0].promptName).toBeNull()
    })
  })
})
