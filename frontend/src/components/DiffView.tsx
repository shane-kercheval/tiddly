/**
 * Diff view component for displaying content differences.
 *
 * Uses react-diff-viewer-continued with custom styling and
 * support for wrap/scroll modes. Includes integrated wrap toggle.
 */
import { useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import { WrapIcon } from './editor/EditorToolbarIcons'
import { Tooltip } from './ui/Tooltip'

/** Base styles for react-diff-viewer-continued (colors and typography) */
const baseDiffStyles = {
  variables: {
    light: {
      diffViewerBackground: '#ffffff',
      diffViewerColor: '#374151',
      addedBackground: '#dcfce7',
      addedColor: '#166534',
      removedBackground: '#fee2e2',
      removedColor: '#991b1b',
      wordAddedBackground: '#bbf7d0',
      wordRemovedBackground: '#fecaca',
      addedGutterBackground: '#bbf7d0',
      removedGutterBackground: '#fecaca',
      gutterBackground: '#f9fafb',
      gutterBackgroundDark: '#f3f4f6',
      highlightBackground: '#fef3c7',
      highlightGutterBackground: '#fde68a',
      codeFoldGutterBackground: '#e5e7eb',
      codeFoldBackground: '#f3f4f6',
      emptyLineBackground: '#f9fafb',
      gutterColor: '#9ca3af',
      addedGutterColor: '#166534',
      removedGutterColor: '#991b1b',
      codeFoldContentColor: '#6b7280',
    },
  },
  line: {
    padding: '2px 8px',
    fontSize: '12px',
  },
  gutter: {
    padding: '0 8px',
    minWidth: '30px',
  },
  contentText: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '12px',
    lineHeight: '1.5',
  },
  codeFold: {
    fontSize: '11px',
    fontStyle: 'italic',
  },
}

/** Styles for wrap mode (default) - removes minWidth to allow natural wrapping */
const wrapModeStyles = {
  ...baseDiffStyles,
  diffContainer: {
    minWidth: 'unset',
  },
}

/** Styles for scroll mode - forces content to not wrap */
const scrollModeStyles = {
  ...baseDiffStyles,
  diffContainer: {
    minWidth: 'max-content',
  },
  content: {
    overflow: 'visible',
  },
  lineContent: {
    overflow: 'visible',
  },
  contentText: {
    ...baseDiffStyles.contentText,
    whiteSpace: 'pre' as const,
    lineBreak: 'auto' as const,
  },
}

/** CSS overrides for scroll mode to force horizontal scrolling */
const scrollModeCss = `
  .diff-scroll-mode table {
    width: max-content !important;
    min-width: 100% !important;
    table-layout: auto !important;
  }
  .diff-scroll-mode td {
    overflow: visible !important;
  }
  .diff-scroll-mode pre {
    white-space: pre !important;
    overflow: visible !important;
  }
  .diff-scroll-mode [class*="content-"] {
    overflow: visible !important;
  }
  .diff-scroll-mode [class*="lineContent-"] {
    overflow: visible !important;
  }
  .diff-scroll-mode [class*="contentText-"] {
    white-space: pre !important;
    word-break: normal !important;
    overflow-wrap: normal !important;
  }
`

/** Loading spinner component for diff viewer */
function DiffLoadingSpinner(): ReactElement {
  return (
    <div className="flex items-center justify-center p-6">
      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-900" />
    </div>
  )
}

export interface DiffViewProps {
  oldContent: string
  newContent: string
  isLoading: boolean
  /** Maximum height of the diff view container. Defaults to 500. */
  maxHeight?: number
}

/** Diff view component using react-diff-viewer-continued */
export function DiffView({
  oldContent,
  newContent,
  isLoading,
  maxHeight = 500,
}: DiffViewProps): ReactNode {
  const [wrapText, setWrapText] = useState(true)

  if (isLoading) {
    return <DiffLoadingSpinner />
  }

  if (oldContent === newContent) {
    return (
      <div className="p-3 text-sm text-gray-500">
        No content changes in this version (metadata only).
      </div>
    )
  }

  const styles = wrapText ? wrapModeStyles : scrollModeStyles

  return (
    <div
      className={`overflow-auto ${wrapText ? '' : 'diff-scroll-mode'}`}
      style={{ maxHeight: `${maxHeight}px` }}
    >
      {/* Wrap toggle button - sticky+float positions relative to content area, avoiding scrollbar */}
      <div className="sticky top-1 float-right z-10 mr-1 mt-1">
        <Tooltip content={wrapText ? 'Disable wrap' : 'Enable wrap'} compact delay={0} position="left">
          <button
            onClick={() => setWrapText(!wrapText)}
            className={`p-0.5 rounded transition-colors border ${
              wrapText
                ? 'text-gray-700 bg-gray-200 hover:bg-gray-300 border-transparent'
                : 'text-gray-500 bg-white hover:text-gray-700 hover:bg-gray-100 shadow-sm border-gray-200'
            }`}
            aria-label={wrapText ? 'Disable text wrap' : 'Enable text wrap'}
          >
            <WrapIcon />
          </button>
        </Tooltip>
      </div>
      {!wrapText && <style>{scrollModeCss}</style>}
      <ReactDiffViewer
        oldValue={oldContent}
        newValue={newContent}
        splitView={false}
        useDarkTheme={false}
        compareMethod={DiffMethod.WORDS}
        styles={styles}
        extraLinesSurroundingDiff={3}
        loadingElement={DiffLoadingSpinner}
      />
    </div>
  )
}
