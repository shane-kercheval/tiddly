import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { localizeKeys } from '../../utils/platform'
import { getShortcut, getShortcutsBySection } from '../../shortcuts/registry'
import { PAGE_SCOPED_SAVE_KEYS, PAGE_SCOPED_SAVE_AND_CLOSE_KEYS } from '../../shortcuts/pageScoped'

function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="inline-flex min-w-[24px] items-center justify-center rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-700">
      {children}
    </kbd>
  )
}

function ShortcutRow({ keys, description }: { keys: readonly string[]; description: string }): ReactNode {
  const localized = localizeKeys([...keys])
  return (
    <tr className="border-b border-gray-100">
      <td className="py-2 pr-4 text-sm text-gray-600">{description}</td>
      <td className="py-2 text-right whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          {localized.map((key, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <span className="text-xs text-gray-400">+</span>}
              <Kbd>{key}</Kbd>
            </span>
          ))}
        </span>
      </td>
    </tr>
  )
}

function InlineShortcut({ keys }: { keys: readonly string[] }): ReactNode {
  const localized = localizeKeys(keys)
  return (
    <span className="inline-flex items-center gap-1">
      {localized.map((key, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-xs text-gray-400">+</span>}
          <Kbd>{key}</Kbd>
        </span>
      ))}
    </span>
  )
}

export function DocsShortcuts(): ReactNode {
  usePageTitle('Docs - Keyboard Shortcuts')
  const actionsShortcuts = getShortcutsBySection('Actions')
  const navigationShortcuts = getShortcutsBySection('Navigation')
  const viewShortcuts = getShortcutsBySection('View')
  const markdownEditorShortcuts = getShortcutsBySection('Markdown Editor')

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Keyboard Shortcuts</h1>
      <p className="text-sm text-gray-600 mb-4">
        Navigate and manage content quickly without reaching for the mouse. Open the shortcuts
        dialog anytime with <InlineShortcut keys={getShortcut('app.showShortcuts').keys} />.
      </p>

      {/* Navigation — sourced from registry */}
      <h2 className="text-lg font-bold text-gray-900 mt-8 mb-3">Navigation</h2>
      <table className="w-full">
        <tbody>
          {navigationShortcuts.map((shortcut) => (
            <ShortcutRow key={shortcut.id} keys={shortcut.keys} description={shortcut.label} />
          ))}
        </tbody>
      </table>

      {/* Actions — registry rows + inline page-scoped save rows in a single
          table. The two save rows (⌘S / ⌘⇧S in Note/Bookmark/Prompt) are
          page-scoped and stay inline per the M5 carve-out (registry doesn't
          model page-scope binding context). */}
      <h2 className="text-lg font-bold text-gray-900 mt-8 mb-3">Actions</h2>
      <table className="w-full">
        <tbody>
          {actionsShortcuts.map((shortcut) => (
            <ShortcutRow key={shortcut.id} keys={shortcut.keys} description={shortcut.label} />
          ))}
          <ShortcutRow keys={PAGE_SCOPED_SAVE_KEYS} description="Save" />
          <ShortcutRow keys={PAGE_SCOPED_SAVE_AND_CLOSE_KEYS} description="Save and close" />
        </tbody>
      </table>

      {/* View — sourced from registry */}
      <h2 className="text-lg font-bold text-gray-900 mt-8 mb-3">View</h2>
      <table className="w-full">
        <tbody>
          {viewShortcuts.map((shortcut) => (
            <ShortcutRow key={shortcut.id} keys={shortcut.keys} description={shortcut.label} />
          ))}
        </tbody>
      </table>

      {/* Markdown Editor — sourced from registry */}
      <h2 className="text-lg font-bold text-gray-900 mt-8 mb-3">Markdown Editor</h2>
      <p className="text-sm text-gray-600 mb-3">
        These shortcuts work when the editor is focused (notes and prompts):
      </p>
      <table className="w-full">
        <tbody>
          {markdownEditorShortcuts.map((shortcut) => (
            <ShortcutRow key={shortcut.id} keys={shortcut.keys} description={shortcut.label} />
          ))}
        </tbody>
      </table>

      {/* Slash Commands */}
      <h2 className="text-lg font-bold text-gray-900 mt-8 mb-3">Slash Commands</h2>
      <p className="text-sm text-gray-600 mb-3">
        Type <Kbd>/</Kbd> at the start of a line in the editor to open a command menu with
        block-level formatting options:
      </p>
      <ul className="space-y-1.5 text-sm text-gray-600 mb-4">
        <li>Heading 1, Heading 2, Heading 3</li>
        <li>Bulleted list, Numbered list, Checklist</li>
        <li>Code block, Blockquote, Link, Horizontal rule</li>
      </ul>
      <p className="text-sm text-gray-600">
        In the prompt editor, the slash menu also includes Jinja2 commands: Variable, If block,
        and If block (trim).
      </p>
    </div>
  )
}
