/**
 * Component for building and managing prompt arguments.
 */
import type { ReactNode } from 'react'
import type { PromptArgument } from '../types'
import { PlusIcon, ChevronUpIcon, ChevronDownIcon, CloseIcon } from './icons'

interface ArgumentsBuilderProps {
  /** Current list of arguments */
  arguments: PromptArgument[]
  /** Called when arguments change */
  onChange: (args: PromptArgument[]) => void
  /** Whether the form is disabled */
  disabled?: boolean
  /** Error message to display */
  error?: string
}

/**
 * ArgumentsBuilder provides UI for managing prompt arguments.
 *
 * Features:
 * - Add new arguments
 * - Edit argument name, description, and required flag
 * - Remove arguments
 * - Reorder arguments with up/down buttons
 */
export function ArgumentsBuilder({
  arguments: args,
  onChange,
  disabled = false,
  error,
}: ArgumentsBuilderProps): ReactNode {
  const addArgument = (): void => {
    onChange([...args, { name: '', description: null, required: false }])
  }

  const updateArgument = (index: number, field: keyof PromptArgument, value: string | boolean | null): void => {
    onChange(
      args.map((arg, i) => (i === index ? { ...arg, [field]: value } : arg))
    )
  }

  const removeArgument = (index: number): void => {
    onChange(args.filter((_, i) => i !== index))
  }

  const moveArgument = (index: number, direction: 'up' | 'down'): void => {
    const newArgs = [...args]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newArgs.length) return
    ;[newArgs[index], newArgs[targetIndex]] = [newArgs[targetIndex], newArgs[index]]
    onChange(newArgs)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <label className="label">Arguments</label>
        <button
          type="button"
          onClick={addArgument}
          disabled={disabled}
          className="btn-icon"
          title="Add argument"
          aria-label="Add argument"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      {error && <p className="error-text mb-2">{error}</p>}

      {args.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          No arguments defined. Arguments are passed by either the human or AI when using the prompt and can be referenced in the template using jinja syntax.
        </p>
      ) : (
        <div className="divide-y divide-gray-200">
          {args.map((arg, index) => (
            <div key={index} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start gap-3">
                {/* Reorder buttons */}
                <div className="flex flex-col gap-0.5 pt-1">
                  <button
                    type="button"
                    onClick={() => moveArgument(index, 'up')}
                    disabled={index === 0 || disabled}
                    className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                    title="Move up"
                  >
                    <ChevronUpIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveArgument(index, 'down')}
                    disabled={index === args.length - 1 || disabled}
                    className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                    title="Move down"
                  >
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Argument fields */}
                <div className="flex-1 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={arg.name}
                    onChange={(e) => updateArgument(index, 'name', e.target.value.toLowerCase())}
                    placeholder="argument_name"
                    disabled={disabled}
                    className="input py-1.5 font-mono text-sm min-w-[140px] flex-[1]"
                    aria-label={`Argument ${index + 1} name`}
                  />
                  <input
                    type="text"
                    value={arg.description || ''}
                    onChange={(e) => updateArgument(index, 'description', e.target.value || null)}
                    placeholder="Description (optional)"
                    disabled={disabled}
                    className="input py-1.5 text-sm min-w-[220px] flex-[4]"
                    aria-label={`Argument ${index + 1} description`}
                  />
                  <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={arg.required ?? false}
                      onChange={(e) => updateArgument(index, 'required', e.target.checked)}
                      disabled={disabled}
                      className="rounded border-gray-300"
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() => removeArgument(index)}
                    disabled={disabled}
                    className="btn-icon-danger"
                    title="Remove argument"
                    aria-label={`Remove argument ${index + 1}`}
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="helper-text mt-2">
        Use lowercase with underscores for argument names (e.g., code_to_review, file_path)
      </p>
    </div>
  )
}
