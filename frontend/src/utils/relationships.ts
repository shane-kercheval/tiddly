/**
 * Utilities for content relationships.
 */
import type { ContentType, RelationshipWithContent } from '../types'

export interface LinkedItem {
  relationshipId: string
  type: ContentType
  id: string
  title: string | null
  url: string | null
  deleted: boolean
  archived: boolean
  description: string | null
}

/**
 * Resolve the "other side" of a relationship given the current content context.
 *
 * Canonical ordering means source/target may not match what the user submitted.
 * This abstracts that away so callers always get the linked item's info.
 */
export function getLinkedItem(
  rel: RelationshipWithContent,
  selfType: ContentType,
  selfId: string,
): LinkedItem {
  const isSelf = rel.source_type === selfType && rel.source_id === selfId
  return {
    relationshipId: rel.id,
    type: (isSelf ? rel.target_type : rel.source_type) as ContentType,
    id: isSelf ? rel.target_id : rel.source_id,
    title: isSelf ? rel.target_title : rel.source_title,
    url: isSelf ? rel.target_url : rel.source_url,
    deleted: isSelf ? rel.target_deleted : rel.source_deleted,
    archived: isSelf ? rel.target_archived : rel.source_archived,
    description: rel.description,
  }
}
