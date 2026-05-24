/**
 * Inline icon tokens for authored markdown.
 *
 * Markdown has no syntax for the small decorative icons that appear mid-sentence
 * in some docs prose (e.g. "click the [pin] icon"). Inlining raw `<svg>` would be
 * stripped by the sanitizer and would pollute the served `.md` with path data.
 * Instead, prose authors write an inline-code token `` `{{icon:<id>}}` `` and the
 * markdown renderer swaps it for the matching component here — the same
 * token-in-markdown pattern `TipBody` uses for `{{shortcut:<id>}}`.
 *
 * An agent reading the raw `.md` sees `{{icon:pin}}`; the surrounding prose always
 * names the icon in words too, so nothing is lost for non-visual consumers.
 */
import type { ReactNode } from 'react'

/** Matches a full inline-code span that is exactly `{{icon:<id>}}`. */
export const ICON_TOKEN_RE = /^\{\{icon:([a-z-]+)\}\}$/

const ICON_CLASS = 'inline-block h-[1.1em] w-[1.1em] align-text-bottom'

/**
 * Icons referenced inline from docs prose, keyed by token id. Lifted verbatim
 * from the legacy JSX so the rendered glyphs are unchanged. Add an entry here
 * when prose needs a new inline icon.
 */
const INLINE_ICONS: Record<string, ReactNode> = {
  // Chrome's toolbar "extensions" puzzle-piece icon.
  extensions: (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h3a1 1 0 0 0 1-1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-1a2 2 0 0 0-4 0v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a2 2 0 0 0 0-4h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1" />
    </svg>
  ),
  // The "pin" icon used to pin an extension to the toolbar.
  pin: (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  ),
  // The Tiddly bookmark/save icon shown on the extension's toolbar button.
  bookmark: (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none">
      <path stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  ),
}

/**
 * Resolve an inline-code token to its icon. Returns `null` when the text is not
 * an icon token so the caller falls back to a normal `<code>` element. Throws on
 * an unknown id so a typo surfaces loudly in tests rather than rendering nothing.
 */
export function resolveInlineIcon(text: string): ReactNode | null {
  const match = ICON_TOKEN_RE.exec(text)
  if (match === null) return null
  const icon = INLINE_ICONS[match[1]]
  if (icon === undefined) {
    throw new Error(`Unknown inline icon token: {{icon:${match[1]}}}`)
  }
  return icon
}
