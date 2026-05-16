/**
 * DOM helpers shared between the shortcut hooks. Centralized so policy
 * decisions (e.g. shadow DOM, contenteditable handling) don't drift across
 * `useGlobalShortcuts` and `usePasteUrlHandler`.
 */

/**
 * True if the currently focused element is a text input, textarea, or
 * contenteditable element. Bare-key shortcuts and paste-URL handling consult
 * this to suppress firing while the user is typing.
 */
export function isInputFocused(): boolean {
  const activeElement = document.activeElement
  if (!activeElement) return false
  const tagName = activeElement.tagName.toUpperCase()
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    (activeElement as HTMLElement).isContentEditable
  )
}
