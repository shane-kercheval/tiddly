/**
 * Generic exact-or-longest-prefix path matching against a set of route prefixes.
 *
 * Strips `?` and `#` suffixes before matching. Exact match wins; otherwise the
 * longest prefix that satisfies `path === prefix || path.startsWith(prefix + '/')`
 * is returned.
 *
 * Used by `routePrefetch.findMatchingRoute` (against the prefetch route table)
 * and by the tips system's `getTipsByArea` (against per-tip area arrays). The
 * algorithm is shared so the two systems agree on what "this prefix covers this
 * path" means; the route tables stay separate because they describe different
 * things.
 */
export function matchPathPrefix(path: string, prefixes: readonly string[]): string | undefined {
  const cleanPath = path.split('?')[0].split('#')[0]

  if (prefixes.includes(cleanPath)) return cleanPath

  let best: string | undefined
  for (const prefix of prefixes) {
    if (cleanPath === prefix || cleanPath.startsWith(prefix + '/')) {
      if (best === undefined || prefix.length > best.length) {
        best = prefix
      }
    }
  }
  return best
}
