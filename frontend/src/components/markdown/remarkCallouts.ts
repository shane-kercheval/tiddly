/**
 * Remark plugin: lower GitHub-style alert blockquotes into docs callouts.
 *
 * Authors write a callout as a blockquote whose first line is an alert marker:
 *
 *   > [!tip]
 *   > **Optional bold title**
 *   >
 *   > Body prose.
 *
 * This is valid, portable markdown (GitHub renders the same markers) and stays
 * readable as raw `.md` for agents. The plugin strips the `[!variant]` marker
 * and tags the blockquote with a `callout callout-<variant>` class; the markdown
 * renderer's `blockquote` component maps that class to the legacy `<InfoCallout>`
 * styling. The title, when present, is just authored bold markdown — no out-of-band
 * metadata — so it round-trips with the rest of the body.
 *
 * Variants collapse to the three the docs use: note/info/important → info,
 * tip → tip, warning/caution → warning. Unrecognized markers are left untouched
 * (rendered as a plain blockquote).
 */
import type { Root, Blockquote, Paragraph, Text } from 'mdast'
import type { CalloutVariant } from '../../pages/docs/components/calloutStyles'

const VARIANT_ALIASES: Record<string, CalloutVariant> = {
  note: 'info',
  info: 'info',
  important: 'info',
  tip: 'tip',
  warning: 'warning',
  caution: 'warning',
}

/** Strips the leading `[!variant]` marker line; returns the resolved variant. */
function extractMarker(blockquote: Blockquote): CalloutVariant | null {
  const firstChild = blockquote.children[0]
  if (firstChild === undefined || firstChild.type !== 'paragraph') return null
  const paragraph = firstChild as Paragraph
  const firstText = paragraph.children[0]
  if (firstText === undefined || firstText.type !== 'text') return null
  const text = firstText as Text

  const match = /^\[!(\w+)\][ \t]*\n?/.exec(text.value)
  if (match === null) return null
  const variant = VARIANT_ALIASES[match[1].toLowerCase()]
  if (variant === undefined) return null

  text.value = text.value.slice(match[0].length)
  // Drop the marker's now-empty text node (and paragraph, if it held only the marker).
  if (text.value === '') {
    paragraph.children.shift()
    if (paragraph.children.length === 0) blockquote.children.shift()
  }
  return variant
}

function visit(node: { type: string; children?: unknown[] }): void {
  if (node.type === 'blockquote') {
    const variant = extractMarker(node as Blockquote)
    if (variant !== null) {
      const data = ((node as Blockquote).data ??= {})
      data.hProperties = { ...(data.hProperties ?? {}), className: ['callout', `callout-${variant}`] }
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      visit(child as { type: string; children?: unknown[] })
    }
  }
}

export function remarkCallouts() {
  return (tree: Root): void => {
    visit(tree as unknown as { type: string; children?: unknown[] })
  }
}
