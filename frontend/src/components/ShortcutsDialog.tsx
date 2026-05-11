/**
 * Dialog showing available keyboard shortcuts.
 *
 * All sections read from the shortcut registry, with one carve-out: the
 * four page-scoped `Cmd+S` / `Cmd+Shift+S` save shortcuts in Note/Bookmark/
 * Prompt (rendered as inline rows appended to the Actions section). Those
 * stay inline indefinitely because the registry doesn't model page-scope
 * binding context — a `match`-omitted entry would silently drift.
 */
import type { ReactNode } from 'react'
import { localizeKeys } from '../utils/platform'
import { getShortcutsBySection } from '../shortcuts/registry'
import { PAGE_SCOPED_SAVE_KEYS, PAGE_SCOPED_SAVE_AND_CLOSE_KEYS } from '../shortcuts/pageScoped'
import type { Shortcut } from '../shortcuts/types'
import { Modal } from './ui/Modal'

interface ShortcutsDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface InlineShortcut {
  keys: readonly string[]
  description: string
}

// Display rows for the page-scoped save shortcuts. The keys come from the
// shared `pageScoped.ts` module so DocsShortcuts and editorCommands' save-and-
// close entry render the same combos without duplicating literals.
const inlineActionsSaves: InlineShortcut[] = [
  { keys: PAGE_SCOPED_SAVE_KEYS, description: 'Save' },
  { keys: PAGE_SCOPED_SAVE_AND_CLOSE_KEYS, description: 'Save and close' },
]

function KeyBadge({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="inline-flex min-w-[24px] items-center justify-center rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-700 shadow-sm">
      {children}
    </kbd>
  )
}

function ShortcutRow({ keys, description }: { keys: readonly string[]; description: string }): ReactNode {
  const localized = localizeKeys([...keys])
  return (
    <li className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-700">{description}</span>
      <div className="flex items-center gap-1">
        {localized.map((key, keyIndex) => (
          <span key={keyIndex} className="flex items-center gap-1">
            {keyIndex > 0 && <span className="text-xs text-gray-400">+</span>}
            <KeyBadge>{key}</KeyBadge>
          </span>
        ))}
      </div>
    </li>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }): ReactNode {
  return (
    <div className="flex items-center gap-3 mb-2">
      <div className="flex-1 border-t border-gray-100" />
      <div className="shrink-0 text-center">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          {title}
        </h3>
        {subtitle && <p className="text-xs text-gray-400 normal-case">{subtitle}</p>}
      </div>
      <div className="flex-1 border-t border-gray-100" />
    </div>
  )
}

function RegistryGroupSection({ title, shortcuts }: { title: string; shortcuts: readonly Shortcut[] }): ReactNode {
  return (
    <div>
      <SectionHeader title={title} />
      <ul className="space-y-1.5">
        {shortcuts.map((shortcut) => (
          <ShortcutRow key={shortcut.id} keys={shortcut.keys} description={shortcut.label} />
        ))}
      </ul>
    </div>
  )
}

/**
 * Actions section renders registry rows AND inline page-scoped save rows as
 * one continuous `<ul>` so the user doesn't see a visual seam between
 * sources. The inline rows are the explicit carve-out (`Cmd+S` /
 * `Cmd+Shift+S` page-scoped saves).
 */
function ActionsSection({
  registryShortcuts,
  inlineRows,
}: {
  registryShortcuts: readonly Shortcut[]
  inlineRows: InlineShortcut[]
}): ReactNode {
  return (
    <div>
      <SectionHeader title="Actions" />
      <ul className="space-y-1.5">
        {registryShortcuts.map((shortcut) => (
          <ShortcutRow key={shortcut.id} keys={shortcut.keys} description={shortcut.label} />
        ))}
        {inlineRows.map((row, index) => (
          <ShortcutRow key={`inline-${index}`} keys={row.keys} description={row.description} />
        ))}
      </ul>
    </div>
  )
}

export function ShortcutsDialog({ isOpen, onClose }: ShortcutsDialogProps): ReactNode {
  const actionsShortcuts = getShortcutsBySection('Actions')
  const navigationShortcuts = getShortcutsBySection('Navigation')
  const viewShortcuts = getShortcutsBySection('View')
  const markdownEditorShortcuts = getShortcutsBySection('Markdown Editor')

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Keyboard Shortcuts"
      maxWidth="max-w-sm md:max-w-3xl"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <div className="space-y-4">
          <ActionsSection registryShortcuts={actionsShortcuts} inlineRows={inlineActionsSaves} />
          <RegistryGroupSection title="Navigation" shortcuts={navigationShortcuts} />
          <RegistryGroupSection title="View" shortcuts={viewShortcuts} />
        </div>
        <div className="space-y-4">
          <RegistryGroupSection title="Markdown Editor" shortcuts={markdownEditorShortcuts} />
        </div>
      </div>
    </Modal>
  )
}
