/**
 * Tests for editorCommands: command list building, Jinja toggling, callbacks.
 *
 * Command ids that have a registry shortcut use the registry id
 * (e.g., `'bold'` → `'editor.bold'`). Entries without a
 * registry shortcut (Jinja, headings, save-and-close, discard) keep local
 * ids. The inline `shortcut:` field is gone — consumers look up keys via
 * `isShortcutId(cmd.id) ? getShortcut(cmd.id).keys : undefined` at render
 * time.
 */
import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { buildEditorCommands, LOCAL_COMMAND_IDS } from './editorCommands'
import { isShortcutId, getShortcut } from '../../shortcuts/registry'

// Mock the sidebar store
const mockTogglePanel = vi.fn()
vi.mock('../../stores/rightSidebarStore', () => ({
  useRightSidebarStore: Object.assign(
    () => ({}),
    {
      getState: () => ({
        togglePanel: mockTogglePanel,
      }),
    }
  ),
}))

// Minimal icon factories that return React elements
const stubIcons = {
  bold: () => createElement('span', null, 'bold'),
  italic: () => createElement('span', null, 'italic'),
  strikethrough: () => createElement('span', null, 'strikethrough'),
  highlight: () => createElement('span', null, 'highlight'),
  inlineCode: () => createElement('span', null, 'inlineCode'),
  codeBlock: () => createElement('span', null, 'codeBlock'),
  link: () => createElement('span', null, 'link'),
  bulletList: () => createElement('span', null, 'bulletList'),
  orderedList: () => createElement('span', null, 'orderedList'),
  checklist: () => createElement('span', null, 'checklist'),
  blockquote: () => createElement('span', null, 'blockquote'),
  horizontalRule: () => createElement('span', null, 'horizontalRule'),
  heading1: () => createElement('span', null, 'heading1'),
  heading2: () => createElement('span', null, 'heading2'),
  heading3: () => createElement('span', null, 'heading3'),
  jinjaVariable: () => createElement('span', null, 'jinjaVariable'),
  jinjaIf: () => createElement('span', null, 'jinjaIf'),
  jinjaIfTrim: () => createElement('span', null, 'jinjaIfTrim'),
  save: () => createElement('span', null, 'save'),
  close: () => createElement('span', null, 'close'),
  tableOfContents: () => createElement('span', null, 'tableOfContents'),
  versionHistory: () => createElement('span', null, 'versionHistory'),
  readingMode: () => createElement('span', null, 'readingMode'),
}

describe('buildEditorCommands', () => {
  it('returns Format and Insert commands without Jinja when showJinja is false', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
    })

    const sections = [...new Set(commands.map((c) => c.section))]
    expect(sections).toContain('Format')
    expect(sections).toContain('Insert')

    const jinjaCommands = commands.filter((c) => c.id.startsWith('jinja'))
    expect(jinjaCommands).toHaveLength(0)
  })

  it('includes Jinja commands when showJinja is true', () => {
    const commands = buildEditorCommands({
      showJinja: true,
      callbacks: {},
      icons: stubIcons,
    })

    const jinjaCommands = commands.filter((c) => c.id.startsWith('jinja'))
    expect(jinjaCommands).toHaveLength(3)
    expect(jinjaCommands.map((c) => c.id)).toEqual([
      'jinja-variable',
      'jinja-if-block',
      'jinja-if-block-trim',
    ])
  })

  it('always includes toggle-history (app.toggleHistorySidebar) in Actions even with no callbacks', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
    })

    const actionCommands = commands.filter((c) => c.section === 'Actions')
    expect(actionCommands).toHaveLength(1)
    expect(actionCommands[0].id).toBe('app.toggleHistorySidebar')
  })

  it('includes save-and-close (local id with shortcutKeys carve-out) when callback provided', () => {
    const onSaveAndClose = vi.fn()
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: { onSaveAndClose },
      icons: stubIcons,
    })

    const cmd = commands.find((c) => c.id === 'save-and-close')
    expect(cmd).toBeDefined()
    expect(cmd!.label).toBe('Save and close')
    // Local id (not in registry) — page-scoped Cmd+Shift+S binds at
    // Note/Bookmark/Prompt handlers, not via the global registry.
    expect(isShortcutId(cmd!.id)).toBe(false)
    // ...but the shortcutKeys carve-out surfaces the hint in the command menu.
    expect(cmd!.shortcutKeys).toEqual(['Mod', 'Shift', 'S'])
  })

  it('includes discard command when callback provided', () => {
    const onDiscard = vi.fn()
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: { onDiscard },
      icons: stubIcons,
    })

    const cmd = commands.find((c) => c.id === 'discard')
    expect(cmd).toBeDefined()
    expect(cmd!.label).toBe('Discard changes')
  })

  it('includes all action commands when all callbacks provided', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {
        onSaveAndClose: vi.fn(),
        onDiscard: vi.fn(),
      },
      icons: stubIcons,
    })

    const actionCommands = commands.filter((c) => c.section === 'Actions')
    expect(actionCommands).toHaveLength(3)
    expect(actionCommands.map((c) => c.id)).toEqual([
      'save-and-close',
      'discard',
      'app.toggleHistorySidebar',
    ])
  })

  it('includes all action commands plus editor.toggleToc when callbacks + showTocToggle', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {
        onSaveAndClose: vi.fn(),
        onDiscard: vi.fn(),
      },
      icons: stubIcons,
      showTocToggle: true,
    })

    const actionCommands = commands.filter((c) => c.section === 'Actions')
    expect(actionCommands).toHaveLength(4)
    expect(actionCommands.map((c) => c.id)).toEqual([
      'save-and-close',
      'discard',
      'editor.toggleToc',
      'app.toggleHistorySidebar',
    ])
  })

  it('includes editor.toggleToc and app.toggleHistorySidebar when no callbacks but showTocToggle is true', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
      showTocToggle: true,
    })

    const actionCommands = commands.filter((c) => c.section === 'Actions')
    expect(actionCommands).toHaveLength(2)
    expect(actionCommands.map((c) => c.id)).toEqual([
      'editor.toggleToc',
      'app.toggleHistorySidebar',
    ])
  })

  it('places Actions section before Format and Insert', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: { onSaveAndClose: vi.fn() },
      icons: stubIcons,
    })

    const sections = commands.map((c) => c.section)
    const actionsFirst = sections.indexOf('Actions')
    const formatFirst = sections.indexOf('Format')
    const insertFirst = sections.indexOf('Insert')
    expect(actionsFirst).toBeLessThan(formatFirst)
    expect(formatFirst).toBeLessThan(insertFirst)
  })

  it('Format ids resolve to registry shortcuts (keys derivable at render time)', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
    })

    // Command ids ARE the registry ids. Render-time lookup yields keys.
    const bold = commands.find((c) => c.id === 'editor.bold')
    expect(bold).toBeDefined()
    expect(isShortcutId(bold!.id)).toBe(true)
    expect(getShortcut(bold!.id as 'editor.bold').keys).toEqual(['Mod', 'B'])

    const italic = commands.find((c) => c.id === 'editor.italic')
    expect(italic).toBeDefined()
    expect(isShortcutId(italic!.id)).toBe(true)
  })

  it('includes Insert commands with the expected ids (mixed local + registry)', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
    })

    const insertIds = commands.filter((c) => c.section === 'Insert').map((c) => c.id)
    // Headings have local ids — no registry shortcut.
    expect(insertIds).toContain('heading-1')
    expect(insertIds).toContain('heading-2')
    expect(insertIds).toContain('heading-3')
    // The rest are renamed to registry ids.
    expect(insertIds).toContain('editor.bulletList')
    expect(insertIds).toContain('editor.numberedList')
    expect(insertIds).toContain('editor.checklist')
    expect(insertIds).toContain('editor.codeBlock')
    expect(insertIds).toContain('editor.blockquote')
    expect(insertIds).toContain('editor.insertLink')
    expect(insertIds).toContain('editor.horizontalRule')
  })

  it('calls onSaveAndClose when save-and-close action is executed', () => {
    const onSaveAndClose = vi.fn()
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: { onSaveAndClose },
      icons: stubIcons,
    })

    const cmd = commands.find((c) => c.id === 'save-and-close')!
    cmd.action(null as never)
    expect(onSaveAndClose).toHaveBeenCalledOnce()
  })

  it('calls onDiscard when discard action is executed', () => {
    const onDiscard = vi.fn()
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: { onDiscard },
      icons: stubIcons,
    })

    const cmd = commands.find((c) => c.id === 'discard')!
    cmd.action(null as never)
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('includes editor.toggleToc when showTocToggle is true; id resolves to registry shortcut', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
      showTocToggle: true,
    })

    const cmd = commands.find((c) => c.id === 'editor.toggleToc')
    expect(cmd).toBeDefined()
    expect(cmd!.label).toBe('Table of Contents')
    expect(cmd!.section).toBe('Actions')
    expect(isShortcutId(cmd!.id)).toBe(true)
    expect(getShortcut(cmd!.id as 'editor.toggleToc').keys).toEqual(['Alt', 'T'])
  })

  it('does not include editor.toggleToc when showTocToggle is false', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
      showTocToggle: false,
    })

    const cmd = commands.find((c) => c.id === 'editor.toggleToc')
    expect(cmd).toBeUndefined()
  })

  it('always includes app.toggleHistorySidebar (label "Version History"); id resolves to registry shortcut', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
    })

    const cmd = commands.find((c) => c.id === 'app.toggleHistorySidebar')
    expect(cmd).toBeDefined()
    // Menu label intentionally differs from the registry label ("Toggle History Sidebar").
    // Labels are surface-local; keys come from the registry.
    expect(cmd!.label).toBe('Version History')
    expect(cmd!.section).toBe('Actions')
    expect(getShortcut(cmd!.id as 'app.toggleHistorySidebar').keys).toEqual(['Mod', 'Shift', '\\'])
  })

  it('calls togglePanel(history) when app.toggleHistorySidebar action is executed', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
    })

    const cmd = commands.find((c) => c.id === 'app.toggleHistorySidebar')!
    cmd.action(null as never)

    expect(mockTogglePanel).toHaveBeenCalledWith('history')
  })

  it('calls togglePanel(toc) when editor.toggleToc action is executed', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
      showTocToggle: true,
    })

    const cmd = commands.find((c) => c.id === 'editor.toggleToc')!
    cmd.action(null as never)

    expect(mockTogglePanel).toHaveBeenCalledWith('toc')
  })
})

describe('buildEditorCommands — schema invariants', () => {
  // Build the most-inclusive command list so every code path executes.
  const commands = buildEditorCommands({
    showJinja: true,
    callbacks: {
      onSaveAndClose: vi.fn(),
      onDiscard: vi.fn(),
      onToggleReadingMode: vi.fn(),
    },
    icons: stubIcons,
    showTocToggle: true,
  })

  it('every command id resolves to either a ShortcutId or a LocalCommandId', () => {
    // Catches "added a new local id but forgot to update LOCAL_COMMAND_IDS"
    // by running the actual build path. The discriminated union also catches
    // this at compile time, but this is the runtime backstop if anything
    // bypasses the type via cast.
    const localIds: ReadonlySet<string> = new Set(LOCAL_COMMAND_IDS)
    for (const cmd of commands) {
      const inRegistry = isShortcutId(cmd.id)
      const inLocalSet = localIds.has(cmd.id)
      expect(inRegistry || inLocalSet).toBe(true)
    }
  })

  it('shortcutKeys is set ONLY on entries whose id is NOT a ShortcutId', () => {
    // Drift guard for the carve-out: a registry-backed entry must derive its
    // keys via getShortcut, not via the shortcutKeys fallback. Anyone reaching
    // for shortcutKeys on a registry-backed entry would introduce a second
    // source of truth — exactly what the registry was built to prevent.
    for (const cmd of commands) {
      if (cmd.shortcutKeys !== undefined) {
        expect(isShortcutId(cmd.id)).toBe(false)
      }
    }
  })

  it('save-and-close is the only entry today that uses the shortcutKeys carve-out', () => {
    // If a new entry surfaces with shortcutKeys, audit whether it could be a
    // registry entry instead. The carve-out should stay narrow.
    const withShortcutKeys = commands.filter((c) => c.shortcutKeys !== undefined)
    expect(withShortcutKeys.map((c) => c.id)).toEqual(['save-and-close'])
  })
})
