import { useState } from 'react'
import { updateAnnotation } from '../services/api'

interface AnnotationFieldProps {
  evaluationId: string
  initialValue: string
}

export default function AnnotationField({ evaluationId, initialValue }: AnnotationFieldProps) {
  const [value, setValue] = useState(initialValue)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await updateAnnotation(evaluationId, value)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Annotation</label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
        placeholder="Add notes about this eval run..."
      />
      <div className="flex items-center gap-3 mt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </div>
  )
}
