/**
 * Component for displaying metadata changes between versions.
 *
 * Renders field-by-field diffs for metadata: arrow notation for short fields,
 * DiffView for description, colored chips for tags and relationships.
 */
import type { ReactNode } from 'react'
import { DiffView } from './DiffView'
import type { HistoryEntityType, HistoryActionType } from '../types'

interface MetadataChangesProps {
  beforeMetadata: Record<string, unknown> | null
  afterMetadata: Record<string, unknown> | null
  entityType: HistoryEntityType
  action: HistoryActionType
}

interface RelationshipSnapshot {
  target_type: string
  target_id: string
  target_title?: string
  relationship_type: string
  description?: string | null
}

/** Human-readable labels for metadata fields */
const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  url: 'URL',
  name: 'Name',
  tags: 'Tags',
  arguments: 'Arguments',
  relationships: 'Links',
}

/** Known fields per entity type (controls which fields to check/display) */
const FIELDS_BY_TYPE: Record<HistoryEntityType, string[]> = {
  bookmark: ['title', 'url', 'tags', 'relationships', 'description'],
  note: ['title', 'tags', 'relationships', 'description'],
  prompt: ['title', 'name', 'tags', 'arguments', 'relationships', 'description'],
}

/** Normalize a string value: treat null/undefined/empty as equivalent */
function normalizeString(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  return String(value)
}

/** Extract tag name from either string (old format) or {id, name} object (new format) */
function tagName(tag: unknown): string {
  if (typeof tag === 'string') return tag
  if (tag && typeof tag === 'object' && 'name' in tag) return String((tag as Record<string, unknown>).name)
  return ''
}

/** Normalize tags: extract names and sort for consistent comparison */
function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(tagName).filter(Boolean).sort()
}

/** Check if two tag arrays are equivalent (same tags regardless of order) */
function tagsEqual(a: unknown, b: unknown): boolean {
  const sortedA = normalizeTags(a)
  const sortedB = normalizeTags(b)
  return sortedA.length === sortedB.length && sortedA.every((tag, i) => tag === sortedB[i])
}

/** Stable JSON stringify that sorts object keys to handle JSONB key reordering */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  if (typeof value === 'object') {
    const sorted = Object.keys(value as Record<string, unknown>).sort()
      .map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]))
    return '{' + sorted.join(',') + '}'
  }
  return JSON.stringify(value)
}

/** Check if arguments changed (key-order-independent comparison) */
function argumentsChanged(a: unknown, b: unknown): boolean {
  return stableStringify(a) !== stableStringify(b)
}

/** Normalize relationships: parse and sort by type then title for consistent comparison */
function normalizeRelationships(value: unknown): RelationshipSnapshot[] {
  if (!Array.isArray(value)) return []
  return [...value]
    .filter((r): r is RelationshipSnapshot => r && typeof r === 'object' && 'target_type' in r && 'target_id' in r)
    .sort((a, b) =>
      a.target_type.localeCompare(b.target_type)
      || (a.target_title ?? '').localeCompare(b.target_title ?? '')
      || a.target_id.localeCompare(b.target_id),
    )
}

/** Build a unique key for a relationship (type + id) */
function relationshipKey(r: RelationshipSnapshot): string {
  return `${r.target_type}:${r.target_id}`
}

/** Build a full comparison key including metadata (description, relationship_type) */
function relationshipFullKey(r: RelationshipSnapshot): string {
  return `${r.target_type}:${r.target_id}:${r.relationship_type ?? ''}:${r.description ?? ''}`
}

/** Check if two relationship arrays are equivalent (including metadata) */
function relationshipsEqual(a: unknown, b: unknown): boolean {
  const normA = normalizeRelationships(a)
  const normB = normalizeRelationships(b)
  if (normA.length !== normB.length) return false
  return normA.every((r, i) => relationshipFullKey(r) === relationshipFullKey(normB[i]))
}

/** Format a relationship for display as a chip label */
function formatRelationshipLabel(r: RelationshipSnapshot): string {
  const title = r.target_title || r.target_id.slice(0, 8) + '...'
  return `${r.target_type}: ${title}`
}

/** Render a short field change with arrow notation */
function ShortFieldChange({ label, before, after }: {
  label: string
  before: string
  after: string
}): ReactNode {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="font-medium text-gray-600 shrink-0">{label}:</span>
      <span className="text-red-600 line-through break-all">{before || '(empty)'}</span>
      <span className="text-gray-400 shrink-0">&rarr;</span>
      <span className="text-green-600 break-all">{after || '(empty)'}</span>
    </div>
  )
}

/** Render tag changes with colored chips */
function TagChanges({ before, after }: {
  before: string[]
  after: string[]
}): ReactNode {
  const added = after.filter(t => !before.includes(t))
  const removed = before.filter(t => !after.includes(t))

  return (
    <div className="flex items-baseline gap-2 text-sm flex-wrap">
      <span className="font-medium text-gray-600 shrink-0">Tags:</span>
      {removed.map(tag => (
        <span key={`rm-${tag}`} className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
          - {tag}
        </span>
      ))}
      {added.map(tag => (
        <span key={`add-${tag}`} className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200">
          + {tag}
        </span>
      ))}
    </div>
  )
}

/** Render relationship changes with colored chips */
function RelationshipChanges({ before, after }: {
  before: RelationshipSnapshot[]
  after: RelationshipSnapshot[]
}): ReactNode {
  const beforeMap = new Map(before.map(r => [relationshipKey(r), r]))
  const afterMap = new Map(after.map(r => [relationshipKey(r), r]))
  const removed = before.filter(r => !afterMap.has(relationshipKey(r)))
  const added = after.filter(r => !beforeMap.has(relationshipKey(r)))

  // Modified: same link identity but different metadata (description or relationship_type)
  const modified: { before: RelationshipSnapshot, after: RelationshipSnapshot }[] = []
  for (const [key, afterRel] of afterMap) {
    const beforeRel = beforeMap.get(key)
    if (beforeRel && relationshipFullKey(beforeRel) !== relationshipFullKey(afterRel)) {
      modified.push({ before: beforeRel, after: afterRel })
    }
  }

  return (
    <div className="flex items-baseline gap-2 text-sm flex-wrap">
      <span className="font-medium text-gray-600 shrink-0">Links:</span>
      {removed.map(r => (
        <span key={`rm-${relationshipKey(r)}`} className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
          - {formatRelationshipLabel(r)}
        </span>
      ))}
      {added.map(r => (
        <span key={`add-${relationshipKey(r)}`} className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200">
          + {formatRelationshipLabel(r)}
        </span>
      ))}
      {modified.map(({ before: b, after: a }) => (
        <span key={`mod-${relationshipKey(a)}`} className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
          ~ {formatRelationshipLabel(a)}{a.description !== b.description && ` (${a.description || 'no description'})`}
        </span>
      ))}
    </div>
  )
}

/** Render initial values for CREATE (v1) — non-empty fields only */
function InitialValues({ metadata, fields }: {
  metadata: Record<string, unknown>
  fields: string[]
}): ReactNode {
  const entries: ReactNode[] = []

  for (const field of fields) {
    const value = metadata[field]
    const label = FIELD_LABELS[field] ?? field

    if (field === 'tags') {
      const tags = normalizeTags(value)
      if (tags.length > 0) {
        entries.push(
          <div key={field} className="flex items-baseline gap-2 text-sm flex-wrap">
            <span className="font-medium text-gray-600 shrink-0">{label}:</span>
            {tags.map((tag: string) => (
              <span key={tag} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                {tag}
              </span>
            ))}
          </div>
        )
      }
    } else if (field === 'relationships') {
      const rels = normalizeRelationships(value)
      if (rels.length > 0) {
        entries.push(
          <div key={field} className="flex items-baseline gap-2 text-sm flex-wrap">
            <span className="font-medium text-gray-600 shrink-0">{label}:</span>
            {rels.map(r => (
              <span key={relationshipKey(r)} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                {formatRelationshipLabel(r)}
              </span>
            ))}
          </div>
        )
      }
    } else if (field === 'arguments') {
      if (Array.isArray(value) && value.length > 0) {
        entries.push(
          <div key={field} className="text-sm">
            <span className="font-medium text-gray-600">{label}:</span>
            <span className="text-gray-700 ml-2">{value.length} argument{value.length !== 1 ? 's' : ''} defined</span>
          </div>
        )
      }
    } else {
      const str = normalizeString(value)
      if (str) {
        entries.push(
          <div key={field} className="text-sm">
            <span className="font-medium text-gray-600">{label}:</span>
            <span className="text-gray-700 ml-2 break-all">{str}</span>
          </div>
        )
      }
    }
  }

  if (entries.length === 0) return null

  return (
    <div className="px-3 py-2 space-y-1.5">
      {entries}
    </div>
  )
}

export function MetadataChanges({
  beforeMetadata,
  afterMetadata,
  entityType,
  action,
}: MetadataChangesProps): ReactNode {
  // Both null — nothing to show
  if (!beforeMetadata && !afterMetadata) return null

  const fields = FIELDS_BY_TYPE[entityType] ?? []

  // CREATE (v1): before is null, show initial values
  if (!beforeMetadata && afterMetadata && action === 'create') {
    return <InitialValues metadata={afterMetadata} fields={fields} />
  }

  // Pruned predecessor: before is null but not CREATE
  if (!beforeMetadata && afterMetadata && action !== 'create') {
    return (
      <div className="px-3 py-2 text-xs text-gray-400 italic">
        Previous metadata unavailable
      </div>
    )
  }

  // Both present — compute field-by-field changes
  const before = beforeMetadata ?? {}
  const after = afterMetadata ?? {}

  const changes: ReactNode[] = []

  for (const field of fields) {
    const label = FIELD_LABELS[field] ?? field
    const beforeVal = before[field]
    const afterVal = after[field]

    if (field === 'tags') {
      if (!tagsEqual(beforeVal, afterVal)) {
        changes.push(
          <TagChanges
            key={field}
            before={normalizeTags(beforeVal)}
            after={normalizeTags(afterVal)}
          />
        )
      }
    } else if (field === 'relationships') {
      if (!relationshipsEqual(beforeVal, afterVal)) {
        changes.push(
          <RelationshipChanges
            key={field}
            before={normalizeRelationships(beforeVal)}
            after={normalizeRelationships(afterVal)}
          />
        )
      }
    } else if (field === 'arguments') {
      if (argumentsChanged(beforeVal, afterVal)) {
        changes.push(
          <div key={field} className="text-sm">
            <span className="font-medium text-gray-600">{label}:</span>
            <span className="text-gray-500 ml-2 italic">Arguments changed</span>
          </div>
        )
      }
    } else if (field === 'description') {
      const beforeStr = normalizeString(beforeVal)
      const afterStr = normalizeString(afterVal)
      if (beforeStr !== afterStr) {
        changes.push(
          <div key={field} className="space-y-1">
            <span className="text-sm font-medium text-gray-600">{label}:</span>
            <div className="-mx-3">
              <DiffView
                oldContent={beforeStr}
                newContent={afterStr}
                isLoading={false}
                maxHeight={200}
              />
            </div>
          </div>
        )
      }
    } else {
      // Short fields: title, url, name
      const beforeStr = normalizeString(beforeVal)
      const afterStr = normalizeString(afterVal)
      if (beforeStr !== afterStr) {
        changes.push(
          <ShortFieldChange
            key={field}
            label={label}
            before={beforeStr}
            after={afterStr}
          />
        )
      }
    }
  }

  // No changes detected — render nothing
  if (changes.length === 0) return null

  return (
    <div className="px-3 py-2 space-y-1.5 border-b border-gray-200">
      {changes}
    </div>
  )
}
