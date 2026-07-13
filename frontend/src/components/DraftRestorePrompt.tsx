import type { ReactNode } from 'react'

interface DraftRestorePromptProps {
  /** When the draft was written (ms epoch), for the "from N minutes ago" copy. */
  savedAt: number
  onRestore: () => void
  onDiscard: () => void
}

function formatAge(savedAt: number): string {
  const minutes = Math.max(1, Math.round((Date.now() - savedAt) / 60_000))
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return `${Math.round(hours / 24)} days ago`
}

/**
 * Offered when an editor mounts and finds a lingering draft (unsaved work
 * from a closed tab, crash, or expired session). Restore applies it over the
 * loaded item; Discard deletes it.
 */
export function DraftRestorePrompt({
  savedAt,
  onRestore,
  onDiscard,
}: DraftRestorePromptProps): ReactNode {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>Unsaved draft from {formatAge(savedAt)}.</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRestore}
          className="rounded-lg bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-gray-700"
        >
          Restore
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Discard
        </button>
      </div>
    </div>
  )
}
