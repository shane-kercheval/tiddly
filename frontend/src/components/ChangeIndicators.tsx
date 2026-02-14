/**
 * Displays small indicator icons showing which fields changed in a history entry.
 *
 * Maps field names from changed_fields to icons with tooltips.
 * Returns null for undefined/empty (old records, audit actions).
 */
import type { ReactNode } from 'react'
import { ContentChangeIcon, TitleChangeIcon, DescriptionChangeIcon, TagIcon, LinkIcon } from './icons'
import { Tooltip } from './ui'

interface ChangeIndicatorsProps {
  changed: string[] | null | undefined
}

/** Field groups: maps changed_fields values to icon + tooltip */
const FIELD_GROUPS: {
  fields: string[]
  icon: (props: { className?: string }) => ReactNode
  label: string
}[] = [
  { fields: ['title', 'url', 'name'], icon: TitleChangeIcon, label: 'Title' },
  { fields: ['description', 'arguments'], icon: DescriptionChangeIcon, label: 'Description' },
  { fields: ['tags'], icon: TagIcon, label: 'Tags' },
  { fields: ['relationships'], icon: LinkIcon, label: 'Links' },
  { fields: ['content'], icon: ContentChangeIcon, label: 'Content' },
]

export function ChangeIndicators({ changed }: ChangeIndicatorsProps): ReactNode {
  if (!changed || changed.length === 0) return null

  const changedSet = new Set(changed)

  // Pre-compute matched groups to avoid rendering empty wrapper
  const matchedGroups = FIELD_GROUPS
    .map(({ fields, icon, label }) => ({
      matchedFields: fields.filter(f => changedSet.has(f)),
      icon,
      label,
    }))
    .filter(g => g.matchedFields.length > 0)

  if (matchedGroups.length === 0) return null

  return (
    <span className="inline-flex items-center gap-1" data-testid="change-indicators">
      {matchedGroups.map(({ matchedFields, icon: Icon, label }) => {
        const FIELD_LABELS: Record<string, string> = { url: 'URL' }
        const tooltip = matchedFields
          .map(f => FIELD_LABELS[f] ?? f.charAt(0).toUpperCase() + f.slice(1))
          .join(', ')

        return (
          <Tooltip key={label} content={tooltip} compact delay={0}>
            <Icon className="h-3.5 w-3.5 text-gray-400" />
          </Tooltip>
        )
      })}
    </span>
  )
}
