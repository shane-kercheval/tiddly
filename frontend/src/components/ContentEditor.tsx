/**
 * Unified content editor with Visual/Markdown mode toggle.
 *
 * Wraps MilkdownEditor (WYSIWYG) and CodeMirrorEditor (raw markdown)
 * with a mode toggle that persists to localStorage.
 *
 * Features:
 * - Visual mode: WYSIWYG editing with Milkdown
 * - Markdown mode: Raw markdown editing with CodeMirror
 * - Mode preference persisted to localStorage
 * - Undo history cleared on mode switch (via key prop)
 * - All formatting shortcuts work in both modes
 */
import { useState, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { MilkdownEditor } from './MilkdownEditor'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import { wasEditorFocused } from '../utils/editorUtils'

/** Editor mode: visual (WYSIWYG) or markdown (raw) */
export type EditorMode = 'visual' | 'markdown'

/** localStorage key for mode preference */
const EDITOR_MODE_KEY = 'editor_mode_preference'

/** localStorage key for wrap text preference */
const WRAP_TEXT_KEY = 'editor_wrap_text'

/**
 * Load editor mode preference from localStorage.
 * Defaults to 'visual' if not set.
 */
function loadModePreference(): EditorMode {
  try {
    const stored = localStorage.getItem(EDITOR_MODE_KEY)
    if (stored === 'visual' || stored === 'markdown') {
      return stored
    }
  } catch {
    // Ignore storage errors
  }
  return 'visual'
}

/**
 * Save editor mode preference to localStorage.
 */
function saveModePreference(mode: EditorMode): void {
  try {
    localStorage.setItem(EDITOR_MODE_KEY, mode)
  } catch {
    // Ignore storage errors
  }
}

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
}

/**
 * ContentEditor provides a unified markdown editor with Visual/Markdown mode toggle.
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
}: ContentEditorProps): ReactNode {
  // Mode state with localStorage persistence
  const [mode, setMode] = useState<EditorMode>(loadModePreference)

  // Track mode switches to force remount and clear undo history
  const [modeKey, setModeKey] = useState(0)

  // Track if we should auto-focus the editor (after mode switch)
  const [shouldAutoFocus, setShouldAutoFocus] = useState(false)

  // Wrap text preference (only applies to Markdown mode)
  const [wrapText, setWrapText] = useState(loadWrapTextPreference)

  // Handle mode change
  const handleModeChange = useCallback((newMode: EditorMode): void => {
    setMode(newMode)
    saveModePreference(newMode)
    setModeKey((prev) => prev + 1) // Force remount to clear undo history
    setShouldAutoFocus(true) // Auto-focus the new editor
  }, [])

  // Reset shouldAutoFocus after editor mounts to prevent re-focusing on every render
  useEffect(() => {
    if (shouldAutoFocus) {
      // Small delay to ensure focus has been applied
      const timer = setTimeout(() => setShouldAutoFocus(false), 50)
      return () => clearTimeout(timer)
    }
  }, [shouldAutoFocus])

  // Handle wrap text change
  const handleWrapTextChange = useCallback((wrap: boolean): void => {
    setWrapText(wrap)
    saveWrapTextPreference(wrap)
  }, [])

  // Global keyboard handlers for editor shortcuts
  // Uses capture phase to intercept before macOS converts to special character (Ω for Alt+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const isMod = e.metaKey || e.ctrlKey

      // Cmd+Shift+M - Toggle between Visual and Markdown modes
      if (isMod && e.shiftKey && e.code === 'KeyM') {
        e.preventDefault()
        e.stopPropagation()
        handleModeChange(mode === 'visual' ? 'markdown' : 'visual')
        return
      }

      // Alt+Z (Option+Z on Mac) - toggle word wrap (only in markdown mode)
      // Use e.code which is independent of keyboard layout and modifier combinations
      if (mode === 'markdown' && e.altKey && e.code === 'KeyZ') {
        e.preventDefault()
        e.stopPropagation()
        handleWrapTextChange(!wrapText)
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [mode, wrapText, handleWrapTextChange, handleModeChange])

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

  // Default helper text based on mode
  const defaultHelperText =
    mode === 'visual'
      ? 'Press ⌘/ to view keyboard shortcuts'
      : 'Markdown mode: Supports **bold**, *italic*, `code`, [links](url), lists, tables'

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
          {/* Wrap text toggle (only in markdown mode) */}
          {mode === 'markdown' && (
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

          {/* Mode toggle - uses onMouseDown to fire before Safari drops focus-within */}
          {/* Only executes if editor was already focused (controls were visible) */}
          <div className="inline-flex rounded-md bg-gray-100 p-0.5" title="Toggle mode (⌘⇧M)">
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                if (wasEditorFocused(e.currentTarget)) {
                  e.preventDefault()
                  handleModeChange('visual')
                }
              }}
              className={`text-xs px-2 py-0.5 rounded transition-all ${
                mode === 'visual'
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
                  handleModeChange('markdown')
                }
              }}
              className={`text-xs px-2 py-0.5 rounded transition-all ${
                mode === 'markdown'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Text
            </button>
          </div>
        </div>
      </div>

      {/* Top divider - hidden when focused since ring takes over */}
      <div className="h-0.5 bg-gray-100 mx-2 group-focus-within/editor:opacity-0 transition-opacity" />

      {/* Editor container */}
      <div className={`overflow-hidden rounded-lg transition-shadow ${getContainerBorderClasses()}`}>
        {mode === 'visual' ? (
          <MilkdownEditor
            key={`milkdown-${modeKey}`}
            value={value}
            onChange={onChange}
            disabled={disabled}
            minHeight={minHeight}
            placeholder={placeholder}
            noPadding={subtleBorder || !showBorder}
            showJinjaTools={showJinjaTools}
            autoFocus={shouldAutoFocus}
            copyContent={value}
          />
        ) : (
          <CodeMirrorEditor
            key={`codemirror-${modeKey}`}
            value={value}
            onChange={onChange}
            disabled={disabled}
            minHeight={minHeight}
            placeholder={placeholder}
            wrapText={wrapText}
            noPadding={subtleBorder || !showBorder}
            autoFocus={shouldAutoFocus}
            copyContent={value}
            showJinjaTools={showJinjaTools}
          />
        )}
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
