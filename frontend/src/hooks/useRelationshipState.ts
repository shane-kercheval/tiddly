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
import { isEffectivelyArchived } from '../utils'

interface UseRelationshipStateParams<S extends { relationships: RelationshipInputPayload[] }> {
  contentType: ContentType
  entityId: string | undefined
  serverRelationships: RelationshipWithContent[] | undefined
  currentRelationships: RelationshipInputPayload[]
  setCurrent: Dispatch<SetStateAction<S>>
  /** Pre-populate display cache for linked items passed via navigation state */
  initialLinkedItems?: LinkedItem[]
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
  initialLinkedItems,
}: UseRelationshipStateParams<S>): UseRelationshipStateResult {
  // Build initial cache seeded with initialLinkedItems (if provided).
  // useMemo ensures this only runs once (deps never change since it captures the first value).
  const initialCache = useMemo(() => {
    const cache = new Map<string, LinkedItem>()
    if (initialLinkedItems) {
      for (const item of initialLinkedItems) {
        cache.set(`${item.type}:${item.id}`, item)
      }
    }
    return cache
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const newLinkedItemsCacheRef = useRef(initialCache)

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
    const items = currentRelationships.map((rel) => {
      const key = `${rel.target_type}:${rel.target_id}`
      return enriched.get(key)
        ?? cachedItems.get(key)
        ?? {
          relationshipId: '',
          type: rel.target_type,
          id: rel.target_id,
          title: null,
          url: null,
          promptName: null,
          deleted: false,
          archived: false,
          description: rel.description ?? null,
        }
    })
    // Sort by type (bookmark → note → prompt) then alphabetically by display label.
    // Use title with promptName fallback so sort order matches what the user sees.
    const typeOrder: Record<string, number> = { bookmark: 0, note: 1, prompt: 2 }
    items.sort((a, b) => {
      const typeDiff = (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99)
      if (typeDiff !== 0) return typeDiff
      const aLabel = a.title ?? a.promptName ?? ''
      const bLabel = b.title ?? b.promptName ?? ''
      if (!aLabel && bLabel) return 1
      if (aLabel && !bLabel) return -1
      return aLabel.localeCompare(bLabel)
    })
    return items
  }, [serverRelationships, entityId, currentRelationships, contentType])

  const handleAddRelationship = useCallback((item: ContentListItem): void => {
    newLinkedItemsCacheRef.current.set(`${item.type}:${item.id}`, {
      relationshipId: '',
      type: item.type,
      id: item.id,
      title: item.title,
      url: item.url,
      promptName: item.name,
      deleted: !!item.deleted_at,
      archived: isEffectivelyArchived(item.archived_at),
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
