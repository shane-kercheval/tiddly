/**
 * Listen for paste events outside input fields and surface valid URLs to a
 * consumer callback. Extracted from the original `useKeyboardShortcuts` hook
 * so paste handling stands on its own — it has nothing to do with the
 * keyboard shortcut registry.
 */

import { useEffect, useRef } from 'react'
import { isValidUrl } from '../utils'
import { isInputFocused } from './dom'

/**
 * @param onPasteUrl - Called with the trimmed URL when a valid URL is pasted
 *   outside any input. Identity may change between renders; the hook reads
 *   through a ref so re-renders don't reinstall the listener.
 */
export function usePasteUrlHandler(onPasteUrl: (url: string) => void): void {
  const onPasteUrlRef = useRef(onPasteUrl)
  useEffect(() => {
    onPasteUrlRef.current = onPasteUrl
  })

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent): void => {
      if (isInputFocused()) return

      const pastedText = event.clipboardData?.getData('text')?.trim()
      if (!pastedText) return

      if (isValidUrl(pastedText)) {
        event.preventDefault()
        onPasteUrlRef.current(pastedText)
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])
}
