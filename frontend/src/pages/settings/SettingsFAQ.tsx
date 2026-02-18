/**
 * Settings page for Frequently Asked Questions.
 *
 * Provides answers to common questions about app functionality.
 */
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

interface FAQItemProps {
  question: string
  answer: ReactNode
}

function FAQItem({ question, answer }: FAQItemProps): ReactNode {
  return (
    <div className="border-b border-gray-100 py-5 last:border-b-0">
      <h3 className="text-base font-medium text-gray-900 mb-2">{question}</h3>
      <div className="text-sm text-gray-600 space-y-2">{answer}</div>
    </div>
  )
}

interface FAQSectionProps {
  title: string
  children: ReactNode
}

function FAQSection({ title, children }: FAQSectionProps): ReactNode {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-gray-900 mb-4">{title}</h2>
      <div className="rounded-lg border border-gray-200 bg-white px-5">
        {children}
      </div>
    </section>
  )
}

/**
 * FAQ settings page.
 */
export function SettingsFAQ(): ReactNode {
  usePageTitle('Settings - FAQ')
  return (
    <div className="max-w-3xl pt-3">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">FAQ</h1>
        <p className="mt-1 text-sm text-gray-500">
          Answers to common questions about how things work.
        </p>
      </div>

      <FAQSection title="Navigation & Interaction">
        <FAQItem
          question="What happens when I click on an item in the content list?"
          answer={
            <>
              <p>
                <strong>Bookmarks:</strong> Clicking the title or URL opens the bookmark
                in a new browser tab. To edit a bookmark, click the pencil icon that appears
                on hover.
              </p>
              <p>
                <strong>Notes & Prompts:</strong> Clicking anywhere on the row opens the
                item for viewing and editing.
              </p>
            </>
          }
        />
        <FAQItem
          question="Why do bookmarks behave differently from notes and prompts?"
          answer={
            <p>
              The behavior is intentionally different to match user intent. When you click a
              bookmark, you most likely want to visit that website. When you click a note or
              prompt, you most likely want to read or edit the content. The edit icon on
              bookmarks provides explicit access to edit mode when needed.
            </p>
          }
        />
      </FAQSection>

      <FAQSection title="Filters & Collections">
        <FAQItem
          question="What is a filter?"
          answer={
            <p>
              Filters are saved views that automatically show content based on content type and tags.
              For example, you can create a "Work" filter that shows all bookmarks and notes
              tagged with "work". Filters support complex logic using AND/OR operators, so you
              can create views like "items tagged 'python' AND 'tutorial'" or "items tagged
              'reading' OR 'research'".
            </p>
          }
        />
        <FAQItem
          question="Does deleting a filter delete the content in it?"
          answer={
            <p>
              No. Deleting a filter only removes the saved view. Your bookmarks, notes, and
              prompts remain untouched. Filters are just a way to view your content—they
              don't own or contain the actual items.
            </p>
          }
        />
        <FAQItem
          question="What is a collection?"
          answer={
            <p>
              Collections are organizational folders in the sidebar that help you group your
              filters together. You can drag filters into collections to keep your sidebar tidy.
              Collections are purely for organization—they don't affect how your content is filtered.
            </p>
          }
        />
        <FAQItem
          question="Does deleting a collection delete the filters in it?"
          answer={
            <p>
              No. When you delete a collection, the filters inside are moved back to the top level
              of the sidebar. Your filters and their settings are preserved.
            </p>
          }
        />
        <FAQItem
          question="How do I reorder items in the sidebar?"
          answer={
            <p>
              Hover over any filter or collection to reveal the drag handle (grip icon) on the
              right side. Click and drag to reorder items. You can rearrange filters, collections,
              and even the built-in items like "All Content".
            </p>
          }
        />
        <FAQItem
          question="How do I add a filter to a collection?"
          answer={
            <p>
              Drag a filter and drop it onto a collection. The collection will highlight when
              you hover over it. You can drop onto a collapsed collection, or drop within an
              expanded collection to place it at a specific position.
            </p>
          }
        />
        <FAQItem
          question="How do I remove a filter from a collection?"
          answer={
            <p>
              Drag the filter out of the collection and drop it at the root level of the sidebar,
              or into a different collection.
            </p>
          }
        />
      </FAQSection>

      <FAQSection title="Tags">
        <FAQItem
          question="Are tags shared between bookmarks, notes, and prompts?"
          answer={
            <p>
              Yes. Tags are global across all content types. If you tag a bookmark with
              "work" and a note with "work", they share the same tag and will appear together
              in any filter or search that uses that tag.
            </p>
          }
        />
        <FAQItem
          question="What happens when I rename a tag?"
          answer={
            <p>
              Renaming a tag updates it everywhere—on all bookmarks, notes, and prompts that
              use it, and in all filters. It's a global rename across your entire account.
            </p>
          }
        />
        <FAQItem
          question="What happens when I delete a tag?"
          answer={
            <p>
              Deleting a tag removes it from all bookmarks, notes, and prompts. The content
              itself is not deleted—only the tag association is removed. If a filter depends
              on that tag, those items will no longer appear in that filter.
            </p>
          }
        />
        <FAQItem
          question="What are inactive tags?"
          answer={
            <p>
              Inactive tags are tags that exist but aren't used by any active content.
              This can happen when you delete or archive all items with a particular tag,
              or when you remove a tag from all items. You can delete inactive tags to
              clean up your tag list.
            </p>
          }
        />
      </FAQSection>

      <FAQSection title="Archive & Trash">
        <FAQItem
          question="What's the difference between archiving and deleting?"
          answer={
            <>
              <p>
                <strong>Archive:</strong> Moves content out of your main view but keeps it
                accessible. Archived items don't appear in lists or searches by default,
                but you can view them in the Archive section and restore them anytime.
              </p>
              <p>
                <strong>Delete:</strong> Moves content to the Trash. Deleted items can be
                restored from the Trash if you change your mind.
              </p>
            </>
          }
        />
        <FAQItem
          question="Can I restore deleted content?"
          answer={
            <p>
              Yes. Deleted items go to the Trash where you can restore them. Currently,
              items remain in the Trash until you manually permanently delete them. In a
              future update, items in Trash will be automatically permanently deleted
              after 30 days.
            </p>
          }
        />
        <FAQItem
          question="Do archived items count toward tag counts?"
          answer={
            <p>
              No. Tag counts shown in the Tags settings page only count active (non-archived,
              non-deleted) content. This is why you might see "inactive tags" - tags that
              exist only on archived or deleted items.
            </p>
          }
        />
      </FAQSection>

      <FAQSection title="Version History">
        <FAQItem
          question="How long is version history kept?"
          answer={
            <p>
              Version history is retained for 30 days, with a maximum of 100 versions per item
              on the free tier. After that, older versions are automatically cleaned up.
            </p>
          }
        />
        <FAQItem
          question="Can I see who or what made a change?"
          answer={
            <p>
              Yes. Each version records the source of the change (web UI, MCP Content Server,
              MCP Prompt Server, API) and the authentication method (Auth0, PAT). For PAT-based
              changes, the token prefix is recorded so you can identify which token was used.
            </p>
          }
        />
        <FAQItem
          question="How do I restore a previous version?"
          answer={
            <p>
              Open an item, go to its history, and select the version you want to restore.
              Restoring rebuilds the full state including content, title, description, and tags.
              The restore itself is recorded as a new version, so you can always undo it.
            </p>
          }
        />
      </FAQSection>

      <FAQSection title="Relationships">
        <FAQItem
          question="What are relationships?"
          answer={
            <p>
              Relationships let you link any content item to any other — bookmark to note,
              note to prompt, bookmark to bookmark, etc. Each link can have an optional
              description. This is useful for connecting related resources, like linking a
              bookmark to your notes about it, or linking a prompt to the reference material
              it draws from.
            </p>
          }
        />
      </FAQSection>

      <FAQSection title="Content Limits">
        <FAQItem
          question="How much content can I store?"
          answer={
            <>
              <p>
                On the free tier: up to 100 bookmarks, 100 notes, and 100 prompts. Each item
                can have up to 100,000 characters of content.
              </p>
              <p>
                Other limits: titles up to 100 characters, descriptions up to 1,000 characters,
                URLs up to 2,048 characters, and tag names up to 50 characters.
              </p>
            </>
          }
        />
      </FAQSection>

      <FAQSection title="Search">
        <FAQItem
          question="What does search look through?"
          answer={
            <p>
              Search looks through titles, descriptions, URLs (for bookmarks), and the
              full content. For bookmarks, the page content is automatically extracted
              when you save the URL. For notes and prompts, your markdown content is searched.
            </p>
          }
        />
        <FAQItem
          question="Can I combine search with filters?"
          answer={
            <p>
              Yes. You can search while viewing a specific filter (which narrows by tags),
              and the search will only look within items matching that filter's criteria.
              You can also add tag filters directly to your search.
            </p>
          }
        />
        <FAQItem
          question="Does search support operators?"
          answer={
            <>
              <p>
                Yes. Search uses PostgreSQL full-text search which supports several operators:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><code className="bg-gray-100 px-1 rounded">"exact phrase"</code> — match an exact phrase</li>
                <li><code className="bg-gray-100 px-1 rounded">-word</code> — exclude results containing a word</li>
                <li><code className="bg-gray-100 px-1 rounded">OR</code> — match either term (e.g., <code className="bg-gray-100 px-1 rounded">python OR javascript</code>)</li>
              </ul>
              <p>
                Search also includes substring matching, so partial words and code symbols
                (like "auth" matching "authentication") work automatically.
              </p>
            </>
          }
        />
      </FAQSection>

      <FAQSection title="API & Integrations">
        <FAQItem
          question="What are Personal Access Tokens (PATs)?"
          answer={
            <p>
              PATs let you access your bookmarks programmatically through the API. You can
              use them for automation, CLI tools, or custom integrations. Tokens are prefixed
              with "bm_" and should be kept secret like a password.
            </p>
          }
        />
        <FAQItem
          question="How do I keep my PAT secure?"
          answer={
            <>
              <p>
                Treat PATs like passwords. Never share them, commit them to version control,
                or expose them in client-side code. Store them in environment variables or
                a secret manager.
              </p>
              <p>
                If you suspect a token has been exposed, delete it immediately in Settings → Tokens
                and create a new one.
              </p>
            </>
          }
        />
        <FAQItem
          question="What is MCP integration?"
          answer={
            <p>
              MCP (Model Context Protocol) is an open standard that allows AI assistants to
              securely access external tools and data. Once configured, you can ask AI agents
              to search your bookmarks, create notes, use your prompt templates, and more—all
              through natural language.
            </p>
          }
        />
        <FAQItem
          question="Which MCP clients are supported?"
          answer={
            <p>
              Any MCP-compatible client works, including Claude Desktop, Claude Code, Cursor,
              and others. The setup instructions in Settings → AI Integration provide configuration
              for Claude Desktop and Claude Code, with similar steps for other clients.
            </p>
          }
        />
        <FAQItem
          question="Why are there two MCP servers?"
          answer={
            <>
              <p>
                <strong>Content Server:</strong> Lets AI agents interact with your data—searching,
                creating, and managing your bookmarks and notes.
              </p>
              <p>
                <strong>Prompt Server:</strong> Provides AI agents with your reusable prompt
                templates. Agents can use your saved prompts and create new ones.
              </p>
              <p>
                They serve different purposes, so you can enable one or both based on your needs.
              </p>
            </>
          }
        />
        <FAQItem
          question="Do I need separate tokens for each MCP server?"
          answer={
            <p>
              It's not required, but recommended if you enable both servers. Using separate tokens
              lets you revoke access to one server without affecting the other, and makes it
              easier to track usage.
            </p>
          }
        />
        <FAQItem
          question="What can AI agents do with my content?"
          answer={
            <>
              <p>
                <strong>Content Server tools:</strong> Search bookmarks and notes by text or tags,
                get full details of specific items, create new bookmarks (with auto-fetched metadata)
                and notes, and list all your tags.
              </p>
              <p>
                <strong>Prompt Server tools:</strong> List available prompts, use prompts with
                variable substitution, and create new prompt templates.
              </p>
            </>
          }
        />
        <FAQItem
          question="What are Skills?"
          answer={
            <>
              <p>
                Skills are an alternative way to use your prompts with AI assistants. Instead of
                connecting via MCP, you export your prompts as SKILL.md files and install them
                directly into your AI client. Skills follow the{' '}
                <a
                  href="https://agentskills.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Agent Skills Standard
                </a>.
              </p>
              <p>
                Supported clients: Claude Code (slash commands), Claude Desktop (capabilities),
                and Codex. Set up skills export in Settings → AI Integration.
              </p>
            </>
          }
        />
        <FAQItem
          question="What are prompt templates with variables?"
          answer={
            <>
              <p>
                Prompts can include variables using Jinja2 syntax, like{' '}
                <code className="bg-gray-100 px-1 rounded">{'{{ topic }}'}</code>. When an AI agent
                uses the prompt, it provides values for these variables, and the final prompt is
                rendered with those values substituted in.
              </p>
              <p>
                This lets you create reusable prompts like "Explain {'{{ topic }}'} in simple terms"
                that work for any topic the agent provides.
              </p>
            </>
          }
        />
      </FAQSection>
    </div>
  )
}
