/**
 * Sanitize a post-login `returnTo` target.
 *
 * `returnTo` flows from `loginWithRedirect({ appState })` into a client-side
 * navigation after Auth0 completes. Accepting an arbitrary value would be an
 * open-redirect vector, so only same-origin **relative** paths are allowed:
 * the value must start with a single `/` (not `//`, which browsers treat as a
 * protocol-relative absolute URL). Anything else falls back to the app root.
 */
export function toSafeReturnTo(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) {
    return value
  }
  return '/'
}
