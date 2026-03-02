import type { ReactNode } from 'react'

const EXAMPLE_PROMPTS = [
  'Search my bookmarks about React hooks',
  'Create a note summarizing what I read today',
  "Find my code-review prompt and use it on this file",
  "List all my prompts tagged 'writing'",
  "Edit my 'daily-standup' prompt to add a new section",
]

/**
 * Example prompts section shown on AI hub and per-client pages.
 */
export function ExamplePrompts(): ReactNode {
  return (
    <div className="mt-8">
      <h3 className="text-base font-semibold text-gray-900 mb-3">Example Prompts</h3>
      <p className="text-gray-600 mb-4 text-sm">
        Try asking your AI assistant:
      </p>
      <div className="flex flex-wrap gap-2">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <span
            key={prompt}
            className="inline-block rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700"
          >
            &ldquo;{prompt}&rdquo;
          </span>
        ))}
      </div>
    </div>
  )
}
