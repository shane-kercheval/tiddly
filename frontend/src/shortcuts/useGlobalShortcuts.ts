/**
 * Subscribe a consumer to a set of registry shortcuts.
 *
 * Each call site declares an `as const` tuple of registry ids it owns, plus
 * a handler map keyed by those same ids. The hook installs a `keydown`
 * listener on `document`, walks the registered tuple via `findMatchingShortcut`,
 * and runs the consumer's handler.
 *
 * MULTI-MOUNT FRIENDLY
 * --------------------
 * Each call installs its own listener with its own handler subset. There is
 * no shared state between mounts. When two mounts both register the same id
 * (today's Escape: Layout closes the dialog, AllContent blurs the search
 * input), both handlers fire on a matching event. Each handler must be
 * safe-as-no-op when its local precondition isn't met.
 *
 * Bubble-phase listeners do NOT call `stopPropagation` — the multi-mount
 * duplicate-id contract requires both listeners to see the event.
 */

import { useEffect, useRef } from 'react'
import { findMatchingShortcut } from './matcher'
import { getShortcut, type ShortcutId } from './registry'
import { isInputFocused } from './dom'
import type { Shortcut, ShortcutMatch } from './types'

/** Stable-key serialization of a match shape for byte-equal comparison. */
function canonicalizeMatch(match: ShortcutMatch): string {
  return JSON.stringify({
    alt: match.alt ?? false,
    code: match.code ?? null,
    key: match.key ?? null,
    mod: match.mod ?? false,
    shift: match.shift ?? false,
  })
}

/**
 * Dev-mode invariant: assert that no two registered entries have byte-equal
 * `match` shapes. Identical shapes would make registry/tuple order silently
 * determine which handler fires — exactly the drift the registry prevents.
 *
 * Cross-module note: `findMatchingShortcut` documents "first match wins";
 * this assertion is what keeps that order-dependence non-load-bearing in
 * practice.
 *
 * Exported for direct unit testing with synthetic shortcut fixtures
 * (verifying the canonicalization actually collides across distinct ids,
 * not just same-id-twice).
 */
export function assertNoDuplicateMatchShapes(shortcuts: readonly Shortcut[]): void {
  const seen = new Map<string, string>()
  for (const shortcut of shortcuts) {
    if (!shortcut.match) continue
    const canonical = canonicalizeMatch(shortcut.match)
    const previous = seen.get(canonical)
    if (previous) {
      throw new Error(
        `useGlobalShortcuts: duplicate match shape ${canonical} between ` +
        `'${previous}' and '${shortcut.id}'. Each consumer's tuple must have ` +
        `unique match shapes — order would otherwise determine which fires.`,
      )
    }
    seen.set(canonical, shortcut.id)
  }
}

/**
 * @param ids - Tuple of registered shortcut ids. `as const` so the
 *   handler-map type can pin to those exact keys. Inline tuples are
 *   tolerated: the install effect keys on a stable serialization of the
 *   tuple, not its array identity, so re-renders do not churn the listener.
 * @param handlers - Map from id to callback. Identity may change between
 *   renders; the hook reads through a ref so re-renders don't reinstall the
 *   listener.
 */
export function useGlobalShortcuts<Ids extends readonly ShortcutId[]>(
  ids: Ids,
  handlers: Record<Ids[number], () => void>,
): void {
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  // Stable string key — decouples listener install/teardown from inline-array
  // identity. JSON.stringify avoids ad hoc delimiter brittleness.
  const idsKey = JSON.stringify(ids)

  useEffect(() => {
    const shortcuts = ids.map((id) => getShortcut(id))

    if (import.meta.env.DEV) {
      assertNoDuplicateMatchShapes(shortcuts)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      const matched = findMatchingShortcut(event, shortcuts)
      if (!matched) return

      if (!matched.allowInInputs && isInputFocused()) {
        return
      }

      // matched.id is structurally one of `ids` because findMatchingShortcut
      // walked `ids.map(getShortcut)`. Cast pins the narrow type for indexing.
      const handler = handlersRef.current[matched.id as Ids[number]]

      // Default true. Set false on Escape so native targets still see it.
      if (matched.preventDefault !== false) {
        event.preventDefault()
      }
      handler()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // ids is captured via the stable string key; the ref-pattern handlers and
    // pure registry lookups don't need to be deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])
}
