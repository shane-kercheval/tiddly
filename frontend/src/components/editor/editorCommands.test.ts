/**
 * Tests for editorCommands: command list building, Jinja toggling, callbacks.
 */
import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { buildEditorCommands } from './editorCommands'

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
  taskList: () => createElement('span', null, 'taskList'),
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
}

describe('buildEditorCommands', () => {
  it('should return Format and Insert commands without Jinja when showJinja is false', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
    })

    const sections = [...new Set(commands.map((c) => c.section))]
    expect(sections).toContain('Format')
    expect(sections).toContain('Insert')

    // No Jinja commands
    const jinjaCommands = commands.filter((c) => c.id.startsWith('jinja'))
    expect(jinjaCommands).toHaveLength(0)
  })

  it('should include Jinja commands when showJinja is true', () => {
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

  it('should not include Actions section when no callbacks provided', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
    })

    const actionCommands = commands.filter((c) => c.section === 'Actions')
    expect(actionCommands).toHaveLength(0)
  })

  it('should include save-and-close command when onSaveAndClose callback provided', () => {
    const onSaveAndClose = vi.fn()
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: { onSaveAndClose },
      icons: stubIcons,
    })

    const cmd = commands.find((c) => c.id === 'save-and-close')
    expect(cmd).toBeDefined()
    expect(cmd!.label).toBe('Save and close')
  })

  it('should include discard command when onDiscard callback provided', () => {
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

  it('should include all action commands when all callbacks provided', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {
        onSaveAndClose: vi.fn(),
        onDiscard: vi.fn(),
      },
      icons: stubIcons,
    })

    const actionCommands = commands.filter((c) => c.section === 'Actions')
    expect(actionCommands).toHaveLength(2)
  })

  it('should place Actions section before Format and Insert', () => {
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

  it('should include formatting commands with shortcuts', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
    })

    const bold = commands.find((c) => c.id === 'bold')
    expect(bold).toBeDefined()
    expect(bold!.shortcut).toBeDefined()
    expect(bold!.shortcut!.length).toBeGreaterThan(0)

    const italic = commands.find((c) => c.id === 'italic')
    expect(italic).toBeDefined()
    expect(italic!.shortcut).toBeDefined()
  })

  it('should include insert commands', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
    })

    const insertIds = commands.filter((c) => c.section === 'Insert').map((c) => c.id)
    expect(insertIds).toContain('heading-1')
    expect(insertIds).toContain('heading-2')
    expect(insertIds).toContain('heading-3')
    expect(insertIds).toContain('bullet-list')
    expect(insertIds).toContain('numbered-list')
    expect(insertIds).toContain('todo-list')
    expect(insertIds).toContain('code-block')
    expect(insertIds).toContain('blockquote')
    expect(insertIds).toContain('link')
    expect(insertIds).toContain('horizontal-rule')
  })

  it('should call onSaveAndClose callback when save-and-close action is executed', () => {
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

  it('should call onDiscard callback when discard action is executed', () => {
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

  it('should include toggle-toc command when showTocToggle is true', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
      showTocToggle: true,
    })

    const cmd = commands.find((c) => c.id === 'toggle-toc')
    expect(cmd).toBeDefined()
    expect(cmd!.label).toBe('Table of Contents')
    expect(cmd!.section).toBe('Actions')
    expect(cmd!.shortcut).toEqual(['⌥', 'T'])
  })

  it('should not include toggle-toc command when showTocToggle is false', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
      showTocToggle: false,
    })

    const cmd = commands.find((c) => c.id === 'toggle-toc')
    expect(cmd).toBeUndefined()
  })

  it('should call togglePanel on store when toggle-toc action is executed', () => {
    const commands = buildEditorCommands({
      showJinja: false,
      callbacks: {},
      icons: stubIcons,
      showTocToggle: true,
    })

    const cmd = commands.find((c) => c.id === 'toggle-toc')!
    cmd.action(null as never)

    expect(mockTogglePanel).toHaveBeenCalledWith('toc')
  })
})
