/**
 * Share mutations (publish / unpublish / rotate) for bookmarks, notes, and prompts.
 *
 * Unlike the per-type mutation files (useBookmarkMutations etc.), this is a single
 * generic hook: the three content types share identical share logic — the only
 * variance is the URL prefix and which list query keys to invalidate — so there's
 * no per-type optimistic-cache surgery to justify three copies.
 *
 * All three endpoints return the full owner detail response (including the updated
 * `is_public`/`public_token`); the caller passes that back into the detail page's
 * local state. We invalidate the list/content query keys so the list-view "shared"
 * indicator refreshes, but the detail page itself is local `useState`, not a query
 * — it relies on the returned item, not invalidation, to update.
 *
 * Sharing is deliberately not a content event (no `updated_at` bump, no history),
 * so history keys are intentionally NOT invalidated here.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { api } from '../services/api'
import { bookmarkKeys } from './useBookmarksQuery'
import { noteKeys } from './useNotesQuery'
import { promptKeys } from './usePromptsQuery'
import { contentKeys } from './useContentQuery'
import type { Bookmark, Note, Prompt } from '../types'

export type ShareableType = 'bookmarks' | 'notes' | 'prompts'

/**
 * Binds a content-type segment to its owner detail type, so `type` and `item`
 * can't drift (a `Note` passed with `type="bookmarks"` won't typecheck).
 */
export interface ShareItemByType {
  bookmarks: Bookmark
  notes: Note
  prompts: Prompt
}

/** Just the share columns — the only fields a share operation legitimately changes. */
interface ShareFields {
  is_public: boolean
  public_token: string | null
}

/**
 * Merge a share response into the detail page's local item, touching ONLY the
 * share columns. The share endpoints return a bare `model_validate` (no partial-
 * read `content_metadata`), so wholesale-replacing the local item would quietly
 * drop content state the detail GET had populated. Sharing changes share state,
 * nothing else — express exactly that.
 */
export function applyShareFields<T extends ShareFields>(prev: T, updated: ShareFields): T {
  return { ...prev, is_public: updated.is_public, public_token: updated.public_token }
}

/** Type-specific list keys to invalidate so the "shared" indicator refreshes. */
const listKeysForType: Record<ShareableType, () => readonly unknown[]> = {
  bookmarks: bookmarkKeys.lists,
  notes: noteKeys.lists,
  prompts: promptKeys.lists,
}

export interface ShareMutations<T> {
  /** Publish: mint a token if absent, set is_public=true. Returns the updated item. */
  publish: UseMutationResult<T, unknown, string>
  /** Unpublish: set is_public=false, keep the token. Returns the updated item. */
  unpublish: UseMutationResult<T, unknown, string>
  /** Rotate: mint a new token (any state), invalidating the old URL. Returns the updated item. */
  rotate: UseMutationResult<T, unknown, string>
}

/**
 * @param type  Content type segment. Its detail type (via {@link ShareItemByType})
 *              determines the response type, so call sites are precisely typed
 *              with no union casts and no risk of a type/item mismatch.
 */
export function useShareMutations<K extends ShareableType>(
  type: K
): ShareMutations<ShareItemByType[K]> {
  type T = ShareItemByType[K]
  const queryClient = useQueryClient()

  const invalidateLists = (): void => {
    queryClient.invalidateQueries({ queryKey: listKeysForType[type]() })
    queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
  }

  const publish = useMutation<T, unknown, string>({
    mutationFn: async (id) => (await api.post<T>(`/${type}/${id}/share`)).data,
    onSuccess: invalidateLists,
  })

  const unpublish = useMutation<T, unknown, string>({
    mutationFn: async (id) => (await api.delete<T>(`/${type}/${id}/share`)).data,
    onSuccess: invalidateLists,
  })

  const rotate = useMutation<T, unknown, string>({
    mutationFn: async (id) => (await api.post<T>(`/${type}/${id}/rotate-share-token`)).data,
    onSuccess: invalidateLists,
  })

  return { publish, unpublish, rotate }
}
