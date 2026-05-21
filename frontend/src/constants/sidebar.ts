/**
 * DOM id of the desktop left sidebar. Shared because the right-sidebar width
 * logic measures this element's width (it collapses w-12 ↔ w-72) to size and
 * track the right sidebar. Naming it once avoids silent failures: a renamed id
 * would otherwise make getElementById return null at every read site, falling
 * back to a 0 width (max computed too large) with no error.
 */
export const DESKTOP_SIDEBAR_ID = 'desktop-sidebar'
