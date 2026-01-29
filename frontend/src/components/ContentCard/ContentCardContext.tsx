/**
 * Context for ContentCard compound component.
 *
 * Provides view state to child components so they can conditionally render
 * based on whether the card is in active, archived, or deleted view.
 */
import { createContext, useContext } from 'react'

export type ContentCardView = 'active' | 'archived' | 'deleted'

export interface ContentCardContextValue {
  view: ContentCardView
}

export const ContentCardContext = createContext<ContentCardContextValue | null>(null)

/**
 * Hook to access ContentCard context.
 * Must be used within a ContentCard component.
 */
export function useContentCardContext(): ContentCardContextValue {
  const context = useContext(ContentCardContext)
  if (!context) {
    throw new Error('ContentCard subcomponents must be used within ContentCard')
  }
  return context
}
