/**
 * Dialog showing available keyboard shortcuts.
 *
 * Navigation, View, and Markdown Editor sections read from the shortcut
 * registry. Only the Actions section still uses an inline array — that
 * migrates in M5 (the four page-scoped `Cmd+S`/`Cmd+Shift+S` entries stay
 * inline indefinitely per the M5 carve-out).
 */
import type { ReactNode } from 'react'
import { localizeKeys } from '../utils/platform'
import { getShortcutsBySection } from '../shortcuts/registry'
import type { Shortcut } from '../shortcuts/types'
import { Modal } from './ui/Modal'

interface ShortcutsDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface InlineShortcut {
  keys: string[]
  description: string
}

interface InlineGroup {
  title: string
  subtitle?: string
  shortcuts: InlineShortcut[]
}

// Inline array for Actions section. Migrated to registry sourcing in M5.
// The four page-scoped `Cmd+S`/`Cmd+Shift+S` entries stay inline indefinitely
// per the plan's M5 carve-out (binding has a context dimension the registry
// doesn't model). Until M5 lands, a registry change to an entry that ALSO
// appears here won't reflect in the dialog — keep these in sync manually.
const inlineActionsGroup: InlineGroup = {
  title: 'Actions',
  shortcuts: [
    { keys: ['⌘', 'V'], description: 'Paste URL to add bookmark' },
    { keys: ['⌘', '⇧', 'Click'], description: 'Open link without tracking' },
    { keys: ['⌘', 'S'], description: 'Save' },
    { keys: ['⌘', '⇧', 'S'], description: 'Save and close' },
  ],
}

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

function InlineGroupSection({ group }: { group: InlineGroup }): ReactNode {
  return (
    <div>
      <SectionHeader title={group.title} subtitle={group.subtitle} />
      <ul className="space-y-1.5">
        {group.shortcuts.map((shortcut, index) => (
          <ShortcutRow key={index} keys={shortcut.keys} description={shortcut.description} />
        ))}
      </ul>
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

export function ShortcutsDialog({ isOpen, onClose }: ShortcutsDialogProps): ReactNode {
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
          <InlineGroupSection group={inlineActionsGroup} />
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
