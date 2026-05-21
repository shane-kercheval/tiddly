/**
 * Header button that toggles the right sidebar between its current width and
 * its maximum. Shared by HistorySidebar and TableOfContentsSidebar so the two
 * stay identical. Desktop-only — callers gate on isDesktop (resize is
 * meaningless when the sidebar is full-width on mobile).
 */
import type { ReactNode } from 'react'
import { useRightSidebarStore } from '../stores/rightSidebarStore'
import { Tooltip } from './ui/Tooltip'
import { shortcutTooltipContent } from './editor/shortcutTooltip'
import { ExpandWidthIcon } from './icons'

export function RightSidebarMaxWidthToggle(): ReactNode {
  const maximized = useRightSidebarStore((state) => state.maximized)
  const toggleMaximized = useRightSidebarStore((state) => state.toggleMaximized)
  const label = maximized ? 'Restore Sidebar Width' : 'Maximize Sidebar Width'

  return (
    <Tooltip content={shortcutTooltipContent('app.toggleSidebarMaxWidth', label)} compact delay={500} position="left">
      <button
        type="button"
        onClick={toggleMaximized}
        aria-label={label}
        aria-pressed={maximized}
        className={`h-[28px] w-[28px] flex items-center justify-center rounded-md ${
          maximized
            ? 'text-gray-700 bg-gray-200'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
        }`}
      >
        <ExpandWidthIcon className="w-5 h-5" />
      </button>
    </Tooltip>
  )
}
