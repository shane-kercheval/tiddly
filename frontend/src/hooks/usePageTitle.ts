import { useEffect } from 'react'

const BASE_TITLE = 'Tiddly'

/**
 * Sets the browser tab title. Resets to base title on unmount.
 *
 * @param title - Page-specific title segment, or undefined to show just "Tiddly"
 */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} - ${BASE_TITLE}` : BASE_TITLE

    return () => {
      document.title = BASE_TITLE
    }
  }, [title])
}
