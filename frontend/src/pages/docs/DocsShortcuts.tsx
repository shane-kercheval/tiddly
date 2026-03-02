import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { InfoCallout } from './components/InfoCallout'

function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="inline-flex min-w-[24px] items-center justify-center rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-700">
      {children}
    </kbd>
  )
}

function ShortcutRow({ keys, description }: { keys: string[]; description: string }): ReactNode {
  return (
    <tr className="border-b border-gray-100">
      <td className="py-2 pr-4 text-sm text-gray-600">{description}</td>
      <td className="py-2 text-right whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          {keys.map((key, i) => (
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

export function DocsShortcuts(): ReactNode {
  usePageTitle('Docs - Keyboard Shortcuts')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Keyboard Shortcuts</h1>
      <p className="text-gray-600 mb-4">
        Navigate and manage content quickly without reaching for the mouse. Open the shortcuts
        dialog anytime with{' '}
        <span className="inline-flex items-center gap-1">
          <Kbd>{'\u2318'}</Kbd><span className="text-xs text-gray-400">+</span>
          <Kbd>{'\u21E7'}</Kbd><span className="text-xs text-gray-400">+</span>
          <Kbd>/</Kbd>
        </span>.
      </p>
      <InfoCallout variant="tip">
        On Windows/Linux, replace <Kbd>{'\u2318'}</Kbd> with <Kbd>Ctrl</Kbd> and{' '}
        <Kbd>{'\u2325'}</Kbd> with <Kbd>Alt</Kbd>.
      </InfoCallout>

      {/* Navigation */}
      <h2 className="text-xl font-bold text-gray-900 mt-8 mb-3">Navigation</h2>
      <table className="w-full">
        <tbody>
          <ShortcutRow keys={['/']} description="Focus search bar" />
          <ShortcutRow keys={['\u2318', '\u21E7', 'P']} description="Command palette" />
          <ShortcutRow keys={['\u2318', 'Click']} description="Open card in new tab" />
          <ShortcutRow keys={['Esc']} description="Close modal / unfocus search" />
        </tbody>
      </table>

      {/* Actions */}
      <h2 className="text-xl font-bold text-gray-900 mt-8 mb-3">Actions</h2>
      <table className="w-full">
        <tbody>
          <ShortcutRow keys={['\u2318', 'V']} description="Paste URL to add bookmark" />
          <ShortcutRow keys={['\u2318', 'S']} description="Save" />
          <ShortcutRow keys={['\u2318', '\u21E7', 'S']} description="Save and close" />
          <ShortcutRow keys={['\u21E7', '\u2318', 'Click']} description="Open link without tracking" />
        </tbody>
      </table>

      {/* View */}
      <h2 className="text-xl font-bold text-gray-900 mt-8 mb-3">View</h2>
      <table className="w-full">
        <tbody>
          <ShortcutRow keys={['w']} description="Toggle full-width layout" />
          <ShortcutRow keys={['\u2318', '\\']} description="Toggle sidebar" />
          <ShortcutRow keys={['\u2318', '\u21E7', '\\']} description="Toggle history sidebar" />
          <ShortcutRow keys={['\u2318', '\u21E7', '/']} description="Show shortcuts dialog" />
          <ShortcutRow keys={['\u2318', '\u21E7', 'M']} description="Toggle reading mode" />
          <ShortcutRow keys={['\u2325', 'Z']} description="Toggle word wrap" />
          <ShortcutRow keys={['\u2325', 'L']} description="Toggle line numbers" />
          <ShortcutRow keys={['\u2325', 'M']} description="Toggle monospace font" />
          <ShortcutRow keys={['\u2325', 'T']} description="Toggle table of contents" />
        </tbody>
      </table>

      {/* Markdown Editor */}
      <h2 className="text-xl font-bold text-gray-900 mt-8 mb-3">Markdown Editor</h2>
      <p className="text-gray-600 mb-3">
        These shortcuts work when the editor is focused (notes and prompts):
      </p>
      <table className="w-full">
        <tbody>
          <ShortcutRow keys={['\u2318', 'B']} description="Bold" />
          <ShortcutRow keys={['\u2318', 'I']} description="Italic" />
          <ShortcutRow keys={['\u2318', '\u21E7', 'X']} description="Strikethrough" />
          <ShortcutRow keys={['\u2318', '\u21E7', 'H']} description="Highlight" />
          <ShortcutRow keys={['\u2318', '\u21E7', '.']} description="Blockquote" />
          <ShortcutRow keys={['\u2318', 'E']} description="Inline code" />
          <ShortcutRow keys={['\u2318', '\u21E7', 'E']} description="Code block" />
          <ShortcutRow keys={['\u2318', '\u21E7', '8']} description="Bullet list" />
          <ShortcutRow keys={['\u2318', '\u21E7', '7']} description="Numbered list" />
          <ShortcutRow keys={['\u2318', '\u21E7', '9']} description="Task list" />
          <ShortcutRow keys={['\u2318', 'K']} description="Insert link" />
          <ShortcutRow keys={['\u2318', '\u21E7', '-']} description="Horizontal rule" />
          <ShortcutRow keys={['\u2318', 'D']} description="Select next occurrence" />
          <ShortcutRow keys={['\u2318', '/']} description="Command menu" />
        </tbody>
      </table>

      {/* Slash Commands */}
      <h2 className="text-xl font-bold text-gray-900 mt-8 mb-3">Slash Commands</h2>
      <p className="text-gray-600 mb-3">
        Type <Kbd>/</Kbd> at the start of a line in the editor to open a command menu with
        block-level formatting options:
      </p>
      <ul className="space-y-1.5 text-gray-600 mb-4">
        <li>Heading 1, Heading 2, Heading 3</li>
        <li>Bulleted list, Numbered list, To-do list</li>
        <li>Code block, Blockquote, Link, Horizontal rule</li>
      </ul>
      <p className="text-gray-600">
        In the prompt editor, the slash menu also includes Jinja2 commands: Variable, If block,
        and If block (trim).
      </p>
    </div>
  )
}
