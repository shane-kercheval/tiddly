/**
 * Modal for trying out a prompt with arguments and seeing the rendered output.
 */
import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { Prompt, PromptArgument } from '../types'
import { Modal } from './ui/Modal'
import { usePrompts } from '../hooks/usePrompts'
import { CopyIcon, CheckIcon } from './icons'

interface TryPromptModalProps {
  isOpen: boolean
  onClose: () => void
  prompt: Prompt
}

/**
 * Modal for previewing how a prompt renders with specific arguments.
 *
 * Users can input values for each argument and see the rendered output
 * in monospace format with whitespace preserved.
 */
export function TryPromptModal({ isOpen, onClose, prompt }: TryPromptModalProps): ReactNode {
  const { renderPrompt } = usePrompts()

  // Track argument values
  const [argValues, setArgValues] = useState<Record<string, string>>({})

  // Track render state
  const [renderedOutput, setRenderedOutput] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setArgValues({})
      setRenderedOutput(null)
      setError(null)
      setIsRendering(false)
      setCopied(false)
    }
  }, [isOpen])

  const handleCopy = async (): Promise<void> => {
    if (!renderedOutput) return
    try {
      await navigator.clipboard.writeText(renderedOutput)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Silent fail
    }
  }

  const handleArgChange = (argName: string, value: string): void => {
    setArgValues(prev => ({ ...prev, [argName]: value }))
    // Clear error when user modifies arguments
    if (error) {
      setError(null)
    }
  }

  const handleRender = async (): Promise<void> => {
    setIsRendering(true)
    setError(null)

    try {
      const result = await renderPrompt(prompt.id, argValues)
      setRenderedOutput(result)
    } catch (err) {
      if (err instanceof Error) {
        // Extract error message from API response if available
        const message = err.message || 'Failed to render prompt'
        setError(message)
      } else {
        setError('Failed to render prompt')
      }
      setRenderedOutput(null)
    } finally {
      setIsRendering(false)
    }
  }

  const hasArguments = prompt.arguments && prompt.arguments.length > 0

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Try Prompt: ${prompt.name}`}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-4">
        {/* Description */}
        <p className="text-sm text-gray-600">
          Preview how this prompt will render with specific argument values. This shows exactly what AI agents will see when they use this prompt. It's useful for testing jinja syntax (e.g conditionals, whitespace control) and ensuring the prompt renders as expected.
        </p>

        {/* Error message */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Arguments section */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">Arguments</h3>
          {hasArguments ? (
            <div className="space-y-3 rounded-lg border border-gray-200 p-4 bg-gray-50">
              {prompt.arguments.map((arg: PromptArgument) => (
                <ArgumentInput
                  key={arg.name}
                  arg={arg}
                  value={argValues[arg.name] || ''}
                  onChange={(value) => handleArgChange(arg.name, value)}
                  disabled={isRendering}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">
              This prompt has no arguments. Click Render to see the static content.
            </p>
          )}
        </div>

        {/* Render button */}
        <button
          type="button"
          onClick={handleRender}
          disabled={isRendering}
          className="btn-primary"
        >
          {isRendering ? 'Rendering...' : 'Render'}
        </button>

        {/* Rendered prompt section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-700">Prompt</h3>
            {renderedOutput !== null && (
              <button
                type="button"
                onClick={handleCopy}
                className="btn-icon text-gray-500 hover:text-gray-700"
                title={copied ? 'Copied!' : 'Copy to clipboard'}
              >
                {copied ? <CheckIcon className="h-4 w-4 text-green-600" /> : <CopyIcon className="h-4 w-4" />}
              </button>
            )}
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 min-h-[200px]">
            {renderedOutput !== null ? (
              <pre className="font-mono text-sm text-gray-900 whitespace-pre-wrap break-words">
                {renderedOutput || '(empty output)'}
              </pre>
            ) : (
              <p className="text-sm text-gray-400 italic">
                Click Render to see prompt
              </p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Input component for a single argument.
 */
interface ArgumentInputProps {
  arg: PromptArgument
  value: string
  onChange: (value: string) => void
  disabled: boolean
}

function ArgumentInput({ arg, value, onChange, disabled }: ArgumentInputProps): ReactNode {
  const isRequired = arg.required === true
  const label = `${arg.name}${isRequired ? ' (required)' : ' (optional)'}`

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        <span className="font-mono">{label}</span>
        {arg.description && (
          <span className="ml-2 font-normal text-gray-500">- {arg.description}</span>
        )}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter value for ${arg.name}`}
        className="input font-mono text-sm w-full resize-y min-h-[60px]"
        disabled={disabled}
        rows={2}
      />
    </div>
  )
}
