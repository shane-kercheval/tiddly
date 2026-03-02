import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { InfoCallout } from './components/InfoCallout'

export function DocsGettingStarted(): ReactNode {
  usePageTitle('Docs - Getting Started')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Getting Started</h1>
      <p className="text-gray-600 mb-8">
        Tiddly is a content management platform for bookmarks, notes, and prompt templates.
        Save and organize web content, write markdown notes, build reusable AI prompt templates,
        and connect everything to your AI assistants via MCP.
      </p>

      {/* Create an Account */}
      <h2 className="text-xl font-bold text-gray-900 mb-3">Create an Account</h2>
      <p className="text-gray-600 mb-2">
        Sign up at{' '}
        <a
          href="https://tiddly.me"
          className="text-[#d97b3d] hover:underline"
        >
          tiddly.me
        </a>
        {' '}to get started. The free tier includes all features with generous capacity limits.
      </p>
      <InfoCallout variant="tip">
        No credit card required. Upgrade to Pro anytime for higher capacity and priority support.
      </InfoCallout>

      {/* Your Content */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-3">Your Content</h2>
      <p className="text-gray-600 mb-4">
        Tiddly organizes your content into three types, all managed from a unified interface:
      </p>
      <ul className="space-y-3 text-gray-600 mb-4">
        <li>
          <strong>Bookmarks</strong> — save URLs with auto-scraped metadata (title, description, page content), personal notes, and tags.
        </li>
        <li>
          <strong>Notes</strong> — freeform markdown documents with tags for capturing ideas, documentation, or anything else.
        </li>
        <li>
          <strong>Prompts</strong> — Jinja2 templates for AI assistants, with typed arguments and version history.
        </li>
      </ul>
      <p className="text-gray-600 mb-2">
        <Link to="/docs/features/content-types" className="text-[#d97b3d] hover:underline">
          Learn more about content types &rarr;
        </Link>
      </p>

      {/* Navigating the App */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-3">Navigating the App</h2>
      <ul className="space-y-3 text-gray-600 mb-4">
        <li>
          <strong>Sidebar</strong> — switch between content type tabs (All, Bookmarks, Notes, Prompts), access saved filters, and browse collections.
        </li>
        <li>
          <strong>Command palette</strong> — press <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">Cmd+Shift+P</code> for quick search and navigation across all content.
        </li>
        <li>
          <strong>Search bar</strong> — press <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">/</code> to focus the search bar for full-text search across all content.
        </li>
      </ul>
      <p className="text-gray-600 mb-2">
        <Link to="/docs/features/shortcuts" className="text-[#d97b3d] hover:underline">
          See all keyboard shortcuts &rarr;
        </Link>
      </p>

      {/* Creating Your First Bookmark */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-3">Creating Your First Bookmark</h2>
      <ol className="list-decimal list-inside space-y-3 text-gray-600 mb-4">
        <li>
          Click the <strong>+</strong> button, or paste a URL with{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">Cmd+V</code> when you&#39;re not focused on an input field.
        </li>
        <li>
          Tiddly automatically scrapes the page for its title, description, and content.
        </li>
        <li>
          Add tags and personal notes to organize and annotate the bookmark.
        </li>
        <li>
          Click a bookmark&#39;s title to open the URL. Use the pencil icon to edit.
        </li>
      </ol>

      {/* Creating Your First Note */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-3">Creating Your First Note</h2>
      <ol className="list-decimal list-inside space-y-3 text-gray-600 mb-4">
        <li>
          Switch to the <strong>Notes</strong> tab in the sidebar, then click <strong>+</strong>.
        </li>
        <li>
          Write in the markdown editor. Use slash commands (<code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">/</code>) for formatting and{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">Cmd+/</code> to open the command menu.
        </li>
        <li>
          Add tags and an optional description.
        </li>
      </ol>

      {/* Creating Your First Prompt */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-3">Creating Your First Prompt</h2>
      <ol className="list-decimal list-inside space-y-3 text-gray-600 mb-4">
        <li>
          Switch to the <strong>Prompts</strong> tab, then click <strong>+</strong>.
        </li>
        <li>
          Write your template using{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">{'{{ variable_name }}'}</code>{' '}
          for placeholders that get filled in at render time.
        </li>
        <li>
          Arguments are automatically detected from your template content — no manual configuration needed.
        </li>
      </ol>
      <p className="text-gray-600 mb-2">
        <Link to="/docs/features/prompts" className="text-[#d97b3d] hover:underline">
          Learn about Jinja2 syntax, conditionals, and more &rarr;
        </Link>
      </p>

      {/* Organizing with Tags & Filters */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-3">Organizing with Tags & Filters</h2>
      <ul className="space-y-3 text-gray-600 mb-4">
        <li>
          <strong>Tags</strong> are shared across all content types — a tag on a bookmark is the same tag available on notes and prompts.
        </li>
        <li>
          <strong>Saved filters</strong> let you create reusable views using tag-based boolean expressions (e.g. &quot;python AND tutorial&quot;).
        </li>
        <li>
          <strong>Collections</strong> group related filters together in the sidebar for quick access.
        </li>
      </ul>
      <p className="text-gray-600 mb-2">
        <Link to="/docs/features/tags-filters" className="text-[#d97b3d] hover:underline">
          Learn more about tags & filters &rarr;
        </Link>
      </p>

      {/* What's Next */}
      <h2 className="text-xl font-bold text-gray-900 mt-10 mb-3">What&#39;s Next</h2>
      <ul className="space-y-2 text-gray-600">
        <li>
          <Link to="/docs/features" className="text-[#d97b3d] hover:underline">Features</Link>
          {' '}&mdash; deeper dives into content types, search, versioning, and more.
        </li>
        <li>
          <Link to="/docs/ai" className="text-[#d97b3d] hover:underline">AI Integration</Link>
          {' '}&mdash; connect Claude, ChatGPT, and other AI assistants to your content via MCP.
        </li>
        <li>
          <Link to="/docs/extensions" className="text-[#d97b3d] hover:underline">Extensions</Link>
          {' '}&mdash; save bookmarks directly from Chrome or Safari.
        </li>
        <li>
          <Link to="/docs/api" className="text-[#d97b3d] hover:underline">API</Link>
          {' '}&mdash; programmatic access with Personal Access Tokens.
        </li>
      </ul>
    </div>
  )
}
