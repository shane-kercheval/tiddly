/**
 * Utilities for content relationships.
 */
import type { ContentType, RelationshipInputPayload, RelationshipWithContent } from '../types'

export interface LinkedItem {
  relationshipId: string
  type: ContentType
  id: string
  title: string | null
  url: string | null
  promptName: string | null
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
    promptName: isSelf ? rel.target_prompt_name : rel.source_prompt_name,
    deleted: isSelf ? rel.target_deleted : rel.source_deleted,
    archived: isSelf ? rel.target_archived : rel.source_archived,
    description: rel.description,
  }
}

/**
 * Convert RelationshipWithContent[] (from entity GET response) to
 * RelationshipInputPayload[] for use in entity state.
 *
 * Resolves canonical ordering so the result always has the "other" entity as target.
 */
export function toRelationshipInputs(
  rels: RelationshipWithContent[],
  selfType: ContentType,
  selfId: string,
): RelationshipInputPayload[] {
  return rels.map((rel) => {
    const isSelf = rel.source_type === selfType && rel.source_id === selfId
    return {
      target_type: (isSelf ? rel.target_type : rel.source_type) as ContentType,
      target_id: isSelf ? rel.target_id : rel.source_id,
      relationship_type: 'related' as const,
      description: rel.description,
    }
  })
}

/**
 * Compare two RelationshipInputPayload[] for equality.
 *
 * Sorts by (target_type, target_id) before comparison to handle order differences.
 */
export function relationshipsEqual(
  a: RelationshipInputPayload[],
  b: RelationshipInputPayload[],
): boolean {
  if (a.length !== b.length) return false
  const sortKey = (r: RelationshipInputPayload): string => `${r.target_type}:${r.target_id}`
  const sortedA = [...a].sort((x, y) => sortKey(x).localeCompare(sortKey(y)))
  const sortedB = [...b].sort((x, y) => sortKey(x).localeCompare(sortKey(y)))
  return sortedA.every((r, i) =>
    r.target_type === sortedB[i].target_type &&
    r.target_id === sortedB[i].target_id &&
    r.relationship_type === sortedB[i].relationship_type &&
    (r.description ?? null) === (sortedB[i].description ?? null)
  )
}
