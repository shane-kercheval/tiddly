/**
 * Scroll to the DOM element whose id matches the current URL hash.
 *
 * Watches `useLocation().hash` and on change (including initial mount) looks
 * up `document.getElementById(hash.slice(1))` and calls `.scrollIntoView`. If
 * no element matches, it's a silent no-op.
 *
 * Depends on `[location.hash]` only. The lazy-loaded page that consumes this
 * hook (e.g. `/docs/tips`) renders synchronously once the chunk arrives —
 * `useEffect` runs after the corresponding DOM commit, so the target element
 * is in place by the time we look it up. Adding `[contentLength]` as a second
 * dep would re-fire on filter/search changes and steal scroll position from
 * the user; don't do that.
 *
 * Silent no-op when the target id is not in the DOM (e.g. filtered out by an
 * active filter on the consuming page). This is fine in v1 because filter
 * state isn't URL-synced — a fresh deep-link load defaults to "show
 * everything," so the target is always present. If filters are ever persisted
 * to the URL, the consuming page should reset its filter state when the hash
 * points at an id that isn't currently rendered.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function useHashScroll(): void {
  const { hash } = useLocation()

  useEffect(() => {
    if (hash.length <= 1) return
    const id = hash.slice(1)
    const element = document.getElementById(id)
    if (element === null) return
    element.scrollIntoView({ block: 'start' })
  }, [hash])
}
