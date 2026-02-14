/**
 * Hook for managing relationship state in entity components.
 *
 * Extracts the common relationship logic shared by Bookmark, Note, and Prompt
 * components: display item derivation, add/remove handlers, and new item cache.
 */
import { useCallback, useMemo, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { getLinkedItem } from '../utils/relationships'
import type { LinkedItem } from '../utils/relationships'
import type { ContentType, ContentListItem, RelationshipInputPayload, RelationshipWithContent } from '../types'

interface UseRelationshipStateParams<S extends { relationships: RelationshipInputPayload[] }> {
  contentType: ContentType
  entityId: string | undefined
  serverRelationships: RelationshipWithContent[] | undefined
  currentRelationships: RelationshipInputPayload[]
  setCurrent: Dispatch<SetStateAction<S>>
}

interface UseRelationshipStateResult {
  linkedItems: LinkedItem[]
  handleAddRelationship: (item: ContentListItem) => void
  handleRemoveRelationship: (item: LinkedItem) => void
  clearNewItemsCache: () => void
}

export function useRelationshipState<S extends { relationships: RelationshipInputPayload[] }>({
  contentType,
  entityId,
  serverRelationships,
  currentRelationships,
  setCurrent,
}: UseRelationshipStateParams<S>): UseRelationshipStateResult {
  const newLinkedItemsCacheRef = useRef(new Map<string, LinkedItem>())

  const linkedItems = useMemo((): LinkedItem[] => {
    const enriched = new Map<string, LinkedItem>()
    if (serverRelationships && entityId) {
      for (const rel of serverRelationships) {
        const item = getLinkedItem(rel, contentType, entityId)
        enriched.set(`${item.type}:${item.id}`, item)
      }
    }
    // Capture ref value once at memo scope (not inside the .map closure).
    // This is a stable display-info cache, not reactive state — safe to read during render.
    const cachedItems = newLinkedItemsCacheRef.current
    // eslint-disable-next-line react-hooks/refs -- cachedItems is a display cache, not reactive state
    return currentRelationships.map((rel) => {
      const key = `${rel.target_type}:${rel.target_id}`
      return enriched.get(key)
        ?? cachedItems.get(key)
        ?? {
          relationshipId: '',
          type: rel.target_type,
          id: rel.target_id,
          title: null,
          url: null,
          deleted: false,
          archived: false,
          description: rel.description ?? null,
        }
    })
  }, [serverRelationships, entityId, currentRelationships, contentType])

  const handleAddRelationship = useCallback((item: ContentListItem): void => {
    newLinkedItemsCacheRef.current.set(`${item.type}:${item.id}`, {
      relationshipId: '',
      type: item.type,
      id: item.id,
      title: item.title,
      url: item.url,
      deleted: !!item.deleted_at,
      archived: !!item.archived_at,
      description: null,
    })
    setCurrent((prev: S) => ({
      ...prev,
      relationships: [...prev.relationships, {
        target_type: item.type,
        target_id: item.id,
        relationship_type: 'related' as const,
      }],
    }))
  }, [setCurrent])

  const handleRemoveRelationship = useCallback((item: LinkedItem): void => {
    setCurrent((prev: S) => ({
      ...prev,
      relationships: prev.relationships.filter(
        (rel) => !(rel.target_type === item.type && rel.target_id === item.id),
      ),
    }))
  }, [setCurrent])

  const clearNewItemsCache = useCallback((): void => {
    newLinkedItemsCacheRef.current.clear()
  }, [])

  return { linkedItems, handleAddRelationship, handleRemoveRelationship, clearNewItemsCache }
}
