import type { Tip } from './types'

/**
 * The single source of truth for the tip corpus.
 *
 * In v1 this is one flat array. The plan defers per-category file splits until
 * the corpus exceeds ~100 tips. Tips here are gold-standard examples that
 * future authoring agents pattern-match on (M5): terse, accurate, no marketing
 * tone, every claim grounded in actual product behavior.
 *
 * Every tip needs `priority` (governs /docs/tips rank). Starter tips
 * additionally need `starterPriority` (governs empty-state pickers in M7).
 * The two fields are independent — set both for starters; just `priority`
 * for non-starters. `priority` is spaced by 10 so authors can insert later
 * tips without renumbering.
 */
export const allTips: Tip[] = [
  {
    id: 'note-slash-commands',
    title: 'Use slash commands in the note and prompt editors',
    body:
      'Type `/` at the start of an empty line to open a menu of block-level formatting: headings, lists, code blocks, callouts, and more. Faster than reaching for the toolbar.',
    categories: ['notes', 'prompts'],
    audience: 'beginner',
    priority: 10,
    areas: ['/app/notes', '/app/prompts'],
    relatedDocs: [{ label: 'Keyboard shortcuts', path: '/docs/features/shortcuts' }],
    starter: true,
    starterPriority: 1,
  },
  {
    id: 'prompt-template-arguments',
    title: 'Define prompt arguments with double-brace placeholders',
    body:
      'Prompts are Jinja2 templates. Wrap a placeholder in double braces — e.g. `{{ topic }}` — and Tiddly auto-detects it as a required argument when you save. Use the run dialog to fill them in.',
    categories: ['prompts'],
    audience: 'beginner',
    priority: 20,
    areas: ['/app/prompts'],
    relatedDocs: [{ label: 'Prompts overview', path: '/docs/features/prompts' }],
    starter: true,
    starterPriority: 2,
  },
  {
    id: 'bookmark-paste-url',
    title: 'Save a bookmark by pasting its URL',
    body:
      'Copy a URL anywhere, then press `⌘+V` from the All Content view (or any saved-filter, archived, or trash view) — outside an input field. The new-bookmark form opens pre-filled with the URL; title and description get auto-fetched.',
    categories: ['bookmarks', 'shortcuts'],
    audience: 'beginner',
    priority: 30,
    areas: ['/app/content'],
    shortcut: ['⌘', 'V'],
    relatedDocs: [{ label: 'Keyboard shortcuts', path: '/docs/features/shortcuts' }],
    starter: true,
    starterPriority: 1,
  },
  {
    id: 'search-quoted-phrase',
    title: 'Match an exact phrase in search',
    body:
      'Wrap a phrase in quotes — e.g. `"machine learning"` — to match it exactly. Without quotes, each word becomes a separate AND clause and stemming may match unexpected variants like `learn` or `learners`.',
    categories: ['search'],
    audience: 'all',
    priority: 40,
    areas: ['/app/content'],
    relatedDocs: [{ label: 'Search syntax', path: '/docs/features/search' }],
  },
  {
    id: 'shortcut-select-next-occurrence',
    title: 'Select the next occurrence in the editor',
    body:
      'With your cursor on a word in a note or prompt, press `⌘+D` to extend the selection to the next match. Repeat to add more matches and edit them simultaneously — useful for renaming a variable or fixing a repeated typo.',
    categories: ['shortcuts', 'editor'],
    audience: 'power',
    priority: 50,
    areas: ['/app/notes', '/app/prompts'],
    shortcut: ['⌘', 'D'],
    relatedDocs: [{ label: 'Keyboard shortcuts', path: '/docs/features/shortcuts' }],
  },
]
