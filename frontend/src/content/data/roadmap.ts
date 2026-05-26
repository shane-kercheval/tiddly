/**
 * Roadmap corpus loader: reads + validates `roadmap.json` at module load.
 *
 * The JSON is the canonical source (served at `/data/roadmap.json`). Validation
 * here replaces the compile-time shape checking lost when this content moved out
 * of TSX — a malformed column or item fails fast at load/test rather than
 * rendering blank or crashing a `.map`. Presentation (per-column accent color)
 * stays in the component; only content lives here. `validateRoadmap` is exported
 * pure so tests can drive it with bad inputs.
 */
import roadmapData from './roadmap.json'

export interface RoadmapItem {
  title: string
  description: string
  date?: string // yyyy-mm, shown as tag on Shipped items
}

export interface RoadmapColumn {
  title: string
  description: string
  items: RoadmapItem[]
}

export interface RoadmapData {
  columns: RoadmapColumn[]
  ideas: RoadmapItem[]
}

function validateItem(rawItem: unknown, context: string, itemIndex: number): RoadmapItem {
  const item = rawItem as Record<string, unknown>
  if (typeof item?.title !== 'string' || item.title.length === 0) {
    throw new Error(`roadmap.json ${context} item ${itemIndex} is missing a title.`)
  }
  if (typeof item.description !== 'string' || item.description.length === 0) {
    throw new Error(`roadmap.json ${context} item "${String(item.title)}" is missing a description.`)
  }
  // `date` is optional everywhere (only Shipped items carry one); when present it must be a string.
  if (item.date !== undefined && typeof item.date !== 'string') {
    throw new Error(`roadmap.json ${context} item "${item.title}" has a non-string date.`)
  }
  return item.date !== undefined
    ? { title: item.title, description: item.description, date: item.date }
    : { title: item.title, description: item.description }
}

export function validateRoadmap(data: unknown): RoadmapData {
  if (typeof data !== 'object' || data === null) {
    throw new Error('roadmap.json must be an object with columns and ideas.')
  }
  const root = data as Record<string, unknown>
  if (!Array.isArray(root.columns)) {
    throw new Error('roadmap.json must have a columns array.')
  }
  if (!Array.isArray(root.ideas)) {
    throw new Error('roadmap.json must have an ideas array.')
  }
  const columns = root.columns.map((rawColumn, columnIndex) => {
    if (typeof rawColumn !== 'object' || rawColumn === null) {
      throw new Error(`roadmap.json column ${columnIndex} is not an object.`)
    }
    const column = rawColumn as Record<string, unknown>
    if (typeof column.title !== 'string' || column.title.length === 0) {
      throw new Error(`roadmap.json column ${columnIndex} is missing a title.`)
    }
    if (typeof column.description !== 'string' || column.description.length === 0) {
      throw new Error(`roadmap.json column "${column.title}" is missing a description.`)
    }
    if (!Array.isArray(column.items)) {
      throw new Error(`roadmap.json column "${column.title}" is missing an items array.`)
    }
    const items = column.items.map((rawItem, itemIndex) =>
      validateItem(rawItem, `column "${column.title}"`, itemIndex),
    )
    return { title: column.title, description: column.description, items }
  })
  const ideas = root.ideas.map((rawItem, itemIndex) => validateItem(rawItem, 'idea', itemIndex))
  return { columns, ideas }
}

export const ROADMAP = validateRoadmap(roadmapData)
