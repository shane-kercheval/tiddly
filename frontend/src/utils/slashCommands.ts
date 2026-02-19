/**
 * Slash command autocomplete source for CodeMirror.
 *
 * Type `/` at the start of a line (or after leading whitespace) to get a
 * filterable dropdown of block-level markdown commands.
 */
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { JINJA_VARIABLE, JINJA_IF_BLOCK, JINJA_IF_BLOCK_TRIM } from '../components/editor/jinjaTemplates'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Render spec used by addToOptions to inject SVG icons. */
interface AddToOptionsSpec {
  render: (completion: Completion, _state: unknown, _view: EditorView) => HTMLElement | null
  position: number
}

// ---------------------------------------------------------------------------
// Section definitions (rank controls ordering)
// ---------------------------------------------------------------------------

const JINJA_SECTION = { name: 'Jinja2', rank: 0 }
const BASIC_SECTION = { name: 'Basic blocks', rank: 1 }
const ADVANCED_SECTION = { name: 'Advanced', rank: 2 }

// ---------------------------------------------------------------------------
// SVG icon markup (24x24 viewBox, matching EditorToolbarIcons.tsx)
// ---------------------------------------------------------------------------

const SVG_ICONS: Record<string, string> = {
  h1: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 12l3-2v8"/></svg>',
  h2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>',
  h3: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>',
  bullet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="3" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1" fill="currentColor" stroke="none"/></svg>',
  number: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6h11M10 12h11M10 18h11"/><text x="2" y="9" font-size="8" fill="currentColor" stroke="none" font-weight="600">1</text><text x="2" y="15" font-size="8" fill="currentColor" stroke="none" font-weight="600">2</text><text x="2" y="21" font-size="8" fill="currentColor" stroke="none" font-weight="600">3</text></svg>',
  todo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="2"/><path stroke-width="2.5" d="M6 12l3 3 5-5"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4c-2 0-3 1-3 3v3c0 1.5-1 2-2 2 1 0 2 .5 2 2v3c0 2 1 3 3 3M16 4c2 0 3 1 3 3v3c0 1.5 1 2 2 2-1 0-2 .5-2 2v3c0 2-1 3-3 3"/></svg>',
  quote: '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="2.5" height="16" rx="1" fill="currentColor"/><path d="M10 8h10M10 12h8M10 16h6" stroke="currentColor" stroke-width="2"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.828 10.172a4 4 0 0 0-5.656 0l-4 4a4 4 0 1 0 5.656 5.656l1.102-1.101"/><path d="M10.172 13.828a4 4 0 0 0 5.656 0l4-4a4 4 0 0 0-5.656-5.656l-1.1 1.1"/></svg>',
  hr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12h16"/></svg>',
  'jinja-var': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4c-2 0-3 1-3 3v3c0 1.5-1 2-2 2 1 0 2 .5 2 2v3c0 2 1 3 3 3M16 4c2 0 3 1 3 3v3c0 1.5 1 2 2 2-1 0-2 .5-2 2v3c0 2-1 3-3 3"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
  'jinja-if': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6l3-3M12 9l-3-3"/><path d="M6 15h12"/><path d="M6 21h12"/></svg>',
  'jinja-if-trim': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6l3-3M12 9l-3-3"/><path d="M6 15h12"/><path d="M6 21h12"/><path d="M3 12h2M19 12h2"/></svg>',
}

// ---------------------------------------------------------------------------
// Build commands
// ---------------------------------------------------------------------------

function applySimple(text: string): (view: EditorView, completion: Completion, from: number, to: number) => void {
  return (view: EditorView, _completion: Completion, from: number, to: number): void => {
    // `from` points after the `/` (for filtering), so back up 1 to replace the slash too
    const slashFrom = from - 1
    view.dispatch({
      changes: { from: slashFrom, to, insert: text },
      selection: { anchor: slashFrom + text.length },
    })
  }
}

function buildCommands(showJinjaTools: boolean): Completion[] {
  // boost values control ordering within sections (higher = listed first).
  // Without boost, autocomplete sorts alphabetically.
  // Array order matches display order (Jinja first when enabled, then Basic, then Advanced).
  const commands: Completion[] = []

  if (showJinjaTools) {
    commands.push(
      {
        label: 'Variable',
        detail: '{{ }}',
        type: 'jinja-var',
        section: JINJA_SECTION,
        boost: 3,
        apply: applySimple(JINJA_VARIABLE),
      },
      {
        label: 'If block',
        detail: '{% if %}',
        type: 'jinja-if',
        section: JINJA_SECTION,
        boost: 2,
        apply: applySimple(JINJA_IF_BLOCK),
      },
      {
        label: 'If block (trim)',
        detail: '{%- if %}',
        type: 'jinja-if-trim',
        section: JINJA_SECTION,
        boost: 1,
        apply: applySimple(JINJA_IF_BLOCK_TRIM),
      },
    )
  }

  commands.push(
    { label: 'Heading 1', detail: '#', type: 'h1', section: BASIC_SECTION, boost: 6, apply: applySimple('# ') },
    { label: 'Heading 2', detail: '##', type: 'h2', section: BASIC_SECTION, boost: 5, apply: applySimple('## ') },
    { label: 'Heading 3', detail: '###', type: 'h3', section: BASIC_SECTION, boost: 4, apply: applySimple('### ') },
    { label: 'Bulleted list', detail: '-', type: 'bullet', section: BASIC_SECTION, boost: 3, apply: applySimple('- ') },
    { label: 'Numbered list', detail: '1.', type: 'number', section: BASIC_SECTION, boost: 2, apply: applySimple('1. ') },
    { label: 'To-do list', detail: '- [ ]', type: 'todo', section: BASIC_SECTION, boost: 1, apply: applySimple('- [ ] ') },
    {
      label: 'Code block',
      detail: '```',
      type: 'code',
      section: ADVANCED_SECTION,
      boost: 4,
      apply: (view: EditorView, _completion: Completion, from: number, to: number): void => {
        const slashFrom = from - 1
        const insert = '```\n\n```'
        view.dispatch({
          changes: { from: slashFrom, to, insert },
          selection: { anchor: slashFrom + 4 }, // cursor on empty line between fences
        })
      },
    },
    { label: 'Blockquote', detail: '>', type: 'quote', section: ADVANCED_SECTION, boost: 3, apply: applySimple('> ') },
    {
      label: 'Link',
      detail: '[]()' ,
      type: 'link',
      section: ADVANCED_SECTION,
      boost: 2,
      apply: (view: EditorView, _completion: Completion, from: number, to: number): void => {
        const slashFrom = from - 1
        const insert = '[text](url)'
        view.dispatch({
          changes: { from: slashFrom, to, insert },
          // Select "url" so user can type the URL immediately
          selection: { anchor: slashFrom + 7, head: slashFrom + 10 },
        })
      },
    },
    {
      label: 'Horizontal rule',
      detail: '---',
      type: 'hr',
      section: ADVANCED_SECTION,
      boost: 1,
      apply: applySimple('---\n'),
    },
  )

  return commands
}

// ---------------------------------------------------------------------------
// Code block detection — is cursor inside a fenced code block?
// ---------------------------------------------------------------------------

function isInsideCodeBlock(context: CompletionContext): boolean {
  const doc = context.state.doc
  const cursorLine = doc.lineAt(context.pos).number
  let fenceCount = 0

  for (let i = 1; i < cursorLine; i++) {
    const lineText = doc.line(i).text.trimStart()
    if (lineText.startsWith('```')) {
      fenceCount++
    }
  }

  // Odd fence count means we're inside an open code block
  return fenceCount % 2 === 1
}

// ---------------------------------------------------------------------------
// Completion source factory
// ---------------------------------------------------------------------------

function createSlashCommandSource(showJinjaTools: boolean): CompletionSource {
  const commands = buildCommands(showJinjaTools)

  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos)
    const textBefore = line.text.slice(0, context.pos - line.from)

    // Match `/` preceded by start-of-line or whitespace, followed by optional filter text.
    // Works at line start, after indentation, or mid-line after a space.
    // Does NOT trigger after non-space chars (e.g. "word/" won't trigger).
    const match = textBefore.match(/(^|\s)\/(\w*)$/)
    if (!match) return null

    // Don't trigger inside fenced code blocks
    if (isInsideCodeBlock(context)) return null

    // `from` is set after the `/` so the default filter matches labels
    // against the typed filter text (e.g. "head" matches "Heading 1").
    // The slash itself is replaced by each command's `apply` function
    // which receives the full range including the slash via `from - 1`.
    const slashPos = line.from + match.index! + match[1].length
    const filterFrom = slashPos + 1 // after the `/`

    return {
      from: filterFrom,
      options: commands,
      validFor: /^\w*$/,
    }
  }
}

// ---------------------------------------------------------------------------
// Shortcut mapping (type → key symbols)
// ---------------------------------------------------------------------------

const SHORTCUT_MAP: Record<string, string[]> = {
  bullet: ['⌘', '⇧', '8'],
  number: ['⌘', '⇧', '7'],
  todo: ['⌘', '⇧', '9'],
  quote: ['⌘', '⇧', '.'],
  code: ['⌘', '⇧', 'E'],
  link: ['⌘', 'K'],
  hr: ['⌘', '⇧', '-'],
}

// ---------------------------------------------------------------------------
// addToOptions — render SVG icons and keyboard shortcuts
// ---------------------------------------------------------------------------

const slashCommandAddToOptions: AddToOptionsSpec[] = [
  {
    render(completion: Completion): HTMLElement | null {
      const svgMarkup = SVG_ICONS[completion.type ?? '']
      if (!svgMarkup) return null

      const wrapper = document.createElement('div')
      wrapper.className = 'cm-slash-icon'
      wrapper.innerHTML = svgMarkup
      return wrapper
    },
    position: 20, // before label (position 50) and detail (position 80)
  },
  {
    render(completion: Completion): HTMLElement | null {
      const keys = SHORTCUT_MAP[completion.type ?? '']
      const wrapper = document.createElement('span')
      wrapper.className = 'cm-slash-shortcut'
      if (keys) {
        for (const key of keys) {
          const kbd = document.createElement('kbd')
          kbd.textContent = key
          wrapper.appendChild(kbd)
        }
      }
      // Always return wrapper (empty = invisible spacer) so detail column aligns
      return wrapper
    },
    position: 90, // after detail (position 80)
  },
]

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { createSlashCommandSource, slashCommandAddToOptions }

/** Exposed for testing only. */
export const _testExports = { buildCommands, isInsideCodeBlock }
