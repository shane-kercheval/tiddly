/**
 * Table of Contents sidebar for navigating markdown headings.
 *
 * Displays a flat list of headings with indentation based on level.
 * Clicking a heading scrolls the editor to that line.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useRightSidebarStore } from '../stores/rightSidebarStore'
import { useResizableSidebar } from '../hooks/useResizableSidebar'
import { parseMarkdownHeadings } from '../utils/markdownHeadings'
import { CloseIcon } from './icons'

interface TableOfContentsSidebarProps {
  content: string
  onHeadingClick: (line: number) => void
}

const INDENT_PX_PER_LEVEL = 16

export function TableOfContentsSidebar({
  content,
  onHeadingClick,
}: TableOfContentsSidebarProps): ReactNode {
  const setActivePanel = useRightSidebarStore((state) => state.setActivePanel)
  const { width, isDesktop, isDragging, handleMouseDown } = useResizableSidebar()

  const headings = useMemo(() => parseMarkdownHeadings(content), [content])

  return (
    <div
      className="fixed top-0 right-0 h-full bg-white border-l border-gray-200 flex flex-col z-50"
      style={isDesktop ? { width: `${width}px` } : { width: '100%' }}
    >
      {/* Drag handle - left edge */}
      {isDesktop && (
        <div
          onMouseDown={handleMouseDown}
          className={`absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-400 transition-colors ${
            isDragging ? 'bg-blue-400' : 'bg-transparent'
          }`}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <h3 className="text-sm font-medium text-gray-900">Table of Contents</h3>
        <button
          type="button"
          onClick={() => setActivePanel(null)}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Heading list */}
      <div className="flex-1 overflow-y-auto">
        {headings.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">
            No headings found.<br />
            Use # to add headings.
          </p>
        ) : (
          <div className="py-2">
            {headings.map((heading, index) => (
              <button
                key={`${heading.line}-${index}`}
                type="button"
                onClick={() => onHeadingClick(heading.line)}
                className="w-full text-left px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors truncate"
                style={{ paddingLeft: `${16 + (heading.level - 1) * INDENT_PX_PER_LEVEL}px` }}
                title={heading.text || '(empty heading)'}
              >
                <span className={heading.level <= 2 ? 'font-medium' : ''}>
                  {heading.text || <span className="text-gray-400 italic">(empty)</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
