/**
 * Resolve a `{{shortcut:<id>}}` inline-code token to an OS-localized `<Kbd>` chip.
 *
 * One shared resolver for both `TipBody` and `DocsMarkdown` so shortcuts in tips
 * and docs render identically and resolve against the single keyboard registry
 * (plus the tip-extra shortcuts). The stored token is OS-agnostic; `formatShortcut`
 * renders it per platform (⌘ on Mac, Ctrl elsewhere). Returns `null` when the text
 * isn't a shortcut token so the caller falls back to a normal `<code>`. Throws on
 * an unknown id (fail-loud — surfaces an authoring typo rather than rendering nothing).
 */
import type { ReactNode } from 'react'
import { SHORTCUT_TOKEN_RE, resolveTipShortcut } from '../../data/tips/tipExtraShortcuts'
import { formatShortcut } from '../../utils/platform'
import { Kbd } from '../ui/Kbd'

export function resolveShortcutToken(text: string): ReactNode | null {
  const match = SHORTCUT_TOKEN_RE.exec(text)
  if (match === null) return null
  return <Kbd>{formatShortcut(resolveTipShortcut(match[1]))}</Kbd>
}
