/**
 * Test page for the ContentEditor with Visual/Markdown mode toggle.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { ContentEditor } from '../../components/ContentEditor'

const SAMPLE_MARKDOWN = `# Welcome to the Editor

This is a **test page** for the unified ContentEditor with Visual/Markdown toggle.

## Features to Test

1. Basic formatting: **bold**, *italic*, ~~strikethrough~~
2. Links: [Example Link](https://example.com)
3. Code blocks:

\`\`\`javascript
const hello = "world";
console.log(hello);
\`\`\`

4. Lists and checkboxes:
   - [ ] Todo item 1
   - [x] Completed item
   - Regular list item

## Tables

| Feature | Description |
|---------|-------------|
| Visual Mode | WYSIWYG editing with Milkdown |
| Markdown Mode | Raw markdown with CodeMirror |
| Mode Toggle | Persists to localStorage |

> This is a blockquote. Try switching between Visual and Markdown modes!
`

export function SettingsEditorPrototype(): ReactNode {
  const [content, setContent] = useState(SAMPLE_MARKDOWN)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Editor Prototype</h1>
        <p className="mt-1 text-sm text-gray-500">
          Test the unified ContentEditor with Visual/Markdown mode toggle.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-2">About the ContentEditor</h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li><strong>Visual mode:</strong> WYSIWYG editing with Milkdown (renders markdown inline)</li>
          <li><strong>Markdown mode:</strong> Raw markdown editing with CodeMirror</li>
          <li><strong>Mode preference:</strong> Persisted to localStorage</li>
          <li><strong>Shortcuts:</strong> Cmd+B (bold), Cmd+I (italic), Cmd+K (link)</li>
          <li><strong>Wrap toggle:</strong> Available in Markdown mode (⌥Z to toggle)</li>
        </ul>
      </div>

      {/* Editor */}
      <ContentEditor
        value={content}
        onChange={setContent}
        label="Content Editor"
        minHeight="400px"
        maxLength={500000}
      />

      {/* Raw markdown output */}
      <div>
        <label className="label mb-2">Raw Markdown Output</label>
        <pre className="p-4 bg-gray-900 text-gray-100 rounded-lg text-xs overflow-auto max-h-64">
          {content}
        </pre>
      </div>

      {/* Reset button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setContent(SAMPLE_MARKDOWN)}
          className="btn-secondary"
        >
          Reset to Sample Content
        </button>
      </div>
    </div>
  )
}
