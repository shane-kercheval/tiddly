import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

export function DocsAIFeatures(): ReactNode {
  usePageTitle('Docs - AI Features')

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">AI Features</h1>
      <p className="text-sm text-gray-600 mb-10">
        Tiddly includes AI-powered features that help you organize, tag, and discover connections
        across your bookmarks, notes, and prompts. All AI features are available on the Pro plan
        and can optionally use your own API keys for additional flexibility.
      </p>

      {/* Tag Suggestions */}
      <h2 className="text-lg font-bold text-gray-900 mb-3">Tag Suggestions</h2>
      <p className="text-sm text-gray-600 mb-3">
        When you open the tag input on any item, AI automatically suggests relevant tags based on
        the item's title, URL, description, and content. Suggestions appear as muted chips to the
        right of your existing tags — click one to add it.
      </p>
      <ul className="space-y-2 text-sm text-gray-600 mb-3">
        <li>
          <strong>How it works</strong> — the server sends your existing tag vocabulary and recent
          tagging patterns to the AI model, which suggests tags that are consistent with your style
        </li>
        <li>
          <strong>Where</strong> — tag input on bookmarks, notes, and prompts (list and detail views)
        </li>
      </ul>

      {/* Metadata Generation */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Metadata Generation</h2>
        <p className="text-sm text-gray-600 mb-3">
          Generate titles and descriptions from your content using the sparkle icon next to each
          field. The AI analyzes your content and produces concise, descriptive text.
        </p>
        <ul className="space-y-2 text-sm text-gray-600 mb-3">
          <li>
            <strong>Title generation</strong> — requires a description or content to generate from.
            If the description is also empty, both title and description are generated together.
          </li>
          <li>
            <strong>Description generation</strong> — requires content to generate from.
            The existing title is used as context for better results.
          </li>
          <li>
            <strong>Where</strong> — sparkle icon on title and description fields in bookmarks, notes, and prompts
          </li>
        </ul>
      </div>

      {/* Relationship Discovery */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Relationship Discovery</h2>
        <p className="text-sm text-gray-600 mb-3">
          Find related content across your library. When you open the linked content input on any
          item, AI searches for items with similar topics and suggests connections.
        </p>
        <ul className="space-y-2 text-sm text-gray-600 mb-3">
          <li>
            <strong>How it works</strong> — the server searches by title relevance and shared tags,
            then asks the AI to identify which candidates are genuinely related
          </li>
          <li>
            <strong>Cross-type</strong> — discovers relationships between bookmarks, notes, and prompts
          </li>
          <li>
            <strong>Where</strong> — linked content input in the detail view of any item
          </li>
        </ul>
      </div>

      {/* Argument Suggestions */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Argument Suggestions</h2>
        <p className="text-sm text-gray-600 mb-3">
          For prompt templates, AI can generate argument names and descriptions based on the
          template content and its <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">{'{{ placeholders }}'}</code>.
        </p>
        <ul className="space-y-2 text-sm text-gray-600 mb-3">
          <li>
            <strong>Generate all</strong> — scans the template for placeholders and generates
            descriptions for each one
          </li>
          <li>
            <strong>Individual suggestions</strong> — suggest a name from a description, or a
            description from a name, for a single argument
          </li>
          <li>
            <strong>Where</strong> — sparkle icons in the prompt editor's arguments section
          </li>
        </ul>
      </div>

      {/* Configuration */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Configuration</h2>
        <p className="text-sm text-gray-600 mb-3">
          AI features work out of the box on the Pro plan with no configuration needed. For more
          control, you can provide your own API keys and choose specific models per use case.
        </p>
        <ul className="space-y-2 text-sm text-gray-600 mb-3">
          <li>
            <strong>Bring Your Own Key (BYOK)</strong> — provide your own API key from Google,
            OpenAI, or Anthropic. Your key is stored only in your browser's local storage and is
            never saved on our servers.
          </li>
          <li>
            <strong>Model selection</strong> — choose from a curated list of models when using
            your own key. Each use case can use a different model and provider.
          </li>
          <li>
            <strong>Rate limits</strong> — AI calls have separate rate limits from regular API
            calls. BYOK users get higher limits. See <Link to="/pricing" className="text-blue-600 hover:underline">pricing</Link> for details.
          </li>
        </ul>
        <p className="text-sm text-gray-600">
          Configure AI settings in{' '}
          <Link to="/app/settings/ai" className="text-blue-600 hover:underline">Settings &rarr; AI Configuration</Link>.
        </p>
      </div>
    </div>
  )
}
