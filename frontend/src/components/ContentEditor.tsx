/**
 * Content editor wrapper component.
 *
 * ARCHITECTURE NOTE (Jan 2026):
 * Previously supported a Markdown/Text mode toggle where:
 * - Markdown mode used MilkdownEditor (rich editing with inline rendering)
 * - Text mode used CodeMirrorEditor (raw markdown with syntax highlighting)
 *
 * MilkdownEditor caused various issues (AST normalization, cursor behavior,
 * formatting edge cases) so we've simplified to always use CodeMirrorEditor
 * with custom visual markdown styling. MilkdownEditor is now only used as a
 * read-only preview (via "Reading" toggle in toolbar).
 *
 * The commented-out mode toggle code is preserved for potential future
 * revisiting once Milkdown matures or if we find better solutions.
 *
 * Current features:
 * - CodeMirror-based editing with visual markdown styling
 * - "Reading" mode toggle for rendered preview (uses MilkdownEditor read-only)
 * - Wrap text preference persisted to localStorage
 * - All formatting shortcuts work via toolbar and keyboard
 */
import { useState, useCallback } from 'react'
import type { ReactNode } from 'react'
// MilkdownEditor now used inside CodeMirrorEditor for reading mode
// import { MilkdownEditor } from './MilkdownEditor'
import { CodeMirrorEditor } from './CodeMirrorEditor'
// wasEditorFocused no longer needed - mode toggle commented out
// import { wasEditorFocused } from '../utils/editorUtils'

/** Editor mode: 'markdown' for rich editing, 'text' for raw markdown */
export type EditorMode = 'markdown' | 'text'

// Mode preference functions commented out - mode toggle disabled
// const EDITOR_MODE_KEY = 'editor_mode_preference'
// function loadModePreference(): EditorMode { ... }
// function saveModePreference(mode: EditorMode): void { ... }

/** localStorage key for wrap text preference */
const WRAP_TEXT_KEY = 'editor_wrap_text'

/** localStorage key for line numbers preference */
const LINE_NUMBERS_KEY = 'editor_line_numbers'

/** localStorage key for mono font preference */
const MONO_FONT_KEY = 'editor_mono_font'

/**
 * Load wrap text preference from localStorage.
 * Defaults to true (wrap on) if not set.
 */
function loadWrapTextPreference(): boolean {
  try {
    const stored = localStorage.getItem(WRAP_TEXT_KEY)
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

/**
 * Save wrap text preference to localStorage.
 */
function saveWrapTextPreference(wrap: boolean): void {
  try {
    localStorage.setItem(WRAP_TEXT_KEY, String(wrap))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Load line numbers preference from localStorage.
 * Defaults to false (line numbers off) if not set.
 */
function loadLineNumbersPreference(): boolean {
  try {
    const stored = localStorage.getItem(LINE_NUMBERS_KEY)
    return stored === 'true'
  } catch {
    return false
  }
}

/**
 * Save line numbers preference to localStorage.
 */
function saveLineNumbersPreference(show: boolean): void {
  try {
    localStorage.setItem(LINE_NUMBERS_KEY, String(show))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Load mono font preference from localStorage.
 * Defaults to false (Inter) if not set.
 */
function loadMonoFontPreference(): boolean {
  try {
    const stored = localStorage.getItem(MONO_FONT_KEY)
    return stored === 'true'
  } catch {
    return false
  }
}

/**
 * Save mono font preference to localStorage.
 */
function saveMonoFontPreference(mono: boolean): void {
  try {
    localStorage.setItem(MONO_FONT_KEY, String(mono))
  } catch {
    // Ignore storage errors
  }
}

interface ContentEditorProps {
  /** Current content value (markdown string) */
  value: string
  /** Called when content changes */
  onChange: (value: string) => void
  /** Whether the editor is disabled */
  disabled?: boolean
  /** Whether there's an error */
  hasError?: boolean
  /** Minimum height for the editor */
  minHeight?: string
  /** Placeholder text shown when empty */
  placeholder?: string
  /** Helper text shown below the editor */
  helperText?: string
  /** Label for the field */
  label?: string
  /** Maximum content length for counter */
  maxLength?: number
  /** Error message to display */
  errorMessage?: string
  /** Whether to show border around editor */
  showBorder?: boolean
  /** Use subtle ring style instead of solid border (matches title/description focus style) */
  subtleBorder?: boolean
  /** Show Jinja2 template tools in toolbar (for prompts) */
  showJinjaTools?: boolean
  /** Called when a modal opens/closes (for beforeunload handlers) */
  onModalStateChange?: (isOpen: boolean) => void
  /** Save and close callback for command menu */
  onSaveAndClose?: () => void
  /** Discard changes callback for command menu (always shown, greyed out when !isDirty) */
  onDiscard?: () => void
  /** Whether the editor has unsaved changes */
  isDirty?: boolean
}

/**
 * ContentEditor provides a unified markdown editor with Markdown/Text mode toggle.
 *
 * Usage:
 * ```tsx
 * <ContentEditor
 *   key={note?.id ?? 'new'}  // Force remount on document change
 *   value={content}
 *   onChange={setContent}
 * />
 * ```
 *
 * Note: Pass a `key` prop based on the document ID to force remount when
 * switching documents. This ensures fresh undo history per document.
 */
export function ContentEditor({
  value,
  onChange,
  disabled = false,
  hasError = false,
  minHeight = '200px',
  placeholder = 'Write your content in markdown...',
  helperText,
  label = 'Content',
  maxLength,
  errorMessage,
  showBorder = true,
  subtleBorder = false,
  showJinjaTools = false,
  onModalStateChange,
  onSaveAndClose,
  onDiscard,
  isDirty,
}: ContentEditorProps): ReactNode {
  // Mode state commented out - now always using CodeMirror
  // const [mode, setMode] = useState<EditorMode>(loadModePreference)
  // const [modeKey, setModeKey] = useState(0)
  // const [shouldAutoFocus, setShouldAutoFocus] = useState(false)
  // const handleModeChange = useCallback((newMode: EditorMode): void => {
  //   setMode(newMode)
  //   saveModePreference(newMode)
  //   setModeKey((prev) => prev + 1)
  //   setShouldAutoFocus(true)
  // }, [])
  // useEffect(() => {
  //   if (shouldAutoFocus) {
  //     const timer = setTimeout(() => setShouldAutoFocus(false), 50)
  //     return () => clearTimeout(timer)
  //   }
  // }, [shouldAutoFocus])

  // Wrap text preference
  const [wrapText, setWrapText] = useState(loadWrapTextPreference)

  // Handle wrap text change
  const handleWrapTextChange = useCallback((wrap: boolean): void => {
    setWrapText(wrap)
    saveWrapTextPreference(wrap)
  }, [])

  // Line numbers preference
  const [showLineNumbers, setShowLineNumbers] = useState(loadLineNumbersPreference)

  // Handle line numbers change
  const handleLineNumbersChange = useCallback((show: boolean): void => {
    setShowLineNumbers(show)
    saveLineNumbersPreference(show)
  }, [])

  // Mono font preference
  const [monoFont, setMonoFont] = useState(loadMonoFontPreference)

  // Handle mono font change
  const handleMonoFontChange = useCallback((mono: boolean): void => {
    setMonoFont(mono)
    saveMonoFontPreference(mono)
  }, [])

  // Note: Option+Z (wrap toggle) handler moved to CodeMirrorEditor
  // where it can check readingMode state

  // Compute container border classes based on props
  // Three modes: no border, solid border, or subtle ring on focus
  const getContainerBorderClasses = (): string => {
    if (!showBorder) {
      return ''
    }

    if (subtleBorder) {
      // Ring style that appears on focus (matches title/description)
      const ringColor = hasError ? 'ring-red-200 ring-2' : 'ring-gray-900/5'
      return `group-focus-within/editor:ring-2 ${ringColor}`
    }

    // Solid border style
    const borderColor = hasError ? 'border-red-300' : 'border-gray-200'
    return `border ${borderColor}`
  }

  // Default helper text
  const defaultHelperText = 'Supports **bold**, *italic*, `code`, [links](url), lists. Press ⌘/ for shortcuts'

  return (
    <div className="group/editor">
      {/* Header with label and mode toggle - hidden until focused */}
      <div className="flex items-center justify-between mb-1">
        {label ? <label className="label">{label}</label> : <div />}
        <div
          className="flex items-center gap-2 opacity-0 group-focus-within/editor:opacity-100 transition-opacity"
          onClick={(e) => {
            // Focus editor when clicking anywhere on the controls (reveals them when hidden)
            const editorGroup = (e.currentTarget as HTMLElement).closest('.group\\/editor')
            // Try ProseMirror (Milkdown) first, then CodeMirror
            const editorElement = editorGroup?.querySelector('.ProseMirror, .cm-content') as HTMLElement
            editorElement?.focus()
          }}
        >
          {/* Mode toggle commented out - now using CodeMirror with Reading mode toggle in toolbar */}
          {/* {mode === 'text' && (
            <label
              className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer mr-2"
              title="Toggle word wrap (⌥Z)"
            >
              <input
                type="checkbox"
                tabIndex={-1}
                checked={wrapText}
                onChange={(e) => handleWrapTextChange(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-gray-600 focus:ring-gray-500/20"
              />
              Wrap
            </label>
          )}
          <div className="inline-flex rounded-md bg-gray-100 p-0.5" title="Toggle mode (⌘⇧M)">
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                if (wasEditorFocused(e.currentTarget)) {
                  e.preventDefault()
                  handleModeChange('markdown')
                }
              }}
              className={`text-xs px-2 py-0.5 rounded transition-all ${
                mode === 'markdown'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Markdown
            </button>
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                if (wasEditorFocused(e.currentTarget)) {
                  e.preventDefault()
                  handleModeChange('text')
                }
              }}
              className={`text-xs px-2 py-0.5 rounded transition-all ${
                mode === 'text'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Text
            </button>
          </div> */}
        </div>
      </div>

      {/* Top divider - hidden when focused since ring takes over */}
      <div className="h-0.5 bg-gray-100 mx-2 group-focus-within/editor:opacity-0 transition-opacity" />

      {/* Editor container - always CodeMirror with Reading/Wrap toggles in toolbar */}
      {/* Note: overflow-hidden removed to allow toolbar wrapping on mobile; editor handles its own overflow */}
      <div className={`rounded-lg transition-shadow ${getContainerBorderClasses()}`}>
        <CodeMirrorEditor
          value={value}
          onChange={onChange}
          disabled={disabled}
          minHeight={minHeight}
          placeholder={placeholder}
          wrapText={wrapText}
          onWrapTextChange={handleWrapTextChange}
          showLineNumbers={showLineNumbers}
          onLineNumbersChange={handleLineNumbersChange}
          monoFont={monoFont}
          onMonoFontChange={handleMonoFontChange}
          noPadding={subtleBorder || !showBorder}
          copyContent={value}
          showJinjaTools={showJinjaTools}
          onModalStateChange={onModalStateChange}
          onSaveAndClose={onSaveAndClose}
          onDiscard={onDiscard}
          isDirty={isDirty}
        />
      </div>

      {/* Footer with helper text and character count - hidden until focused, but always visible when error */}
      <div className={`flex justify-between items-center mt-1 transition-opacity ${errorMessage ? 'opacity-100' : 'opacity-0 group-focus-within/editor:opacity-100'}`}>
        {errorMessage ? (
          <p className="error-text">{errorMessage}</p>
        ) : (
          <p className="helper-text">{helperText ?? defaultHelperText}</p>
        )}
        {maxLength && (
          <span className="helper-text">
            {value.length.toLocaleString()}/{maxLength.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  )
}
