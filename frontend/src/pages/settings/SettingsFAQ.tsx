/**
 * Settings page for Frequently Asked Questions.
 *
 * Provides answers to common questions about app functionality.
 */
import type { ReactNode } from 'react'

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
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
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
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">FAQ</h1>
        <p className="mt-1 text-sm text-gray-500">
          Answers to common questions about how things work.
        </p>
      </div>

      <FAQSection title="Navigation & Interaction">
        <FAQItem
          question="What happens when I click the title of an item in a list?"
          answer={
            <>
              <p>
                <strong>Bookmarks:</strong> Clicking the title or URL opens the bookmark
                in a new browser tab.
              </p>
              <p>
                <strong>Notes:</strong> Clicking the title opens the note in view mode,
                where you can read the full content.
              </p>
            </>
          }
        />
        <FAQItem
          question="How do I edit a bookmark or note from the list?"
          answer={
            <p>
              Click anywhere on the row (except the title/URL). A pencil icon appears on hover
              to indicate the row is clickable. For bookmarks, this opens the edit dialog.
              For notes, this opens the edit page.
            </p>
          }
        />
      </FAQSection>

      <FAQSection title="Lists & Groups">
        <FAQItem
          question="What is the purpose of a list?"
          answer={
            <p>
              Lists are saved views that automatically filter your content based on content type and tags.
              For example, you can create a "Work" list that shows all bookmarks and notes
              tagged with "work". Lists support complex filters using AND/OR logic, so you
              can create views like "items tagged 'python' AND 'tutorial'" or "items tagged
              'reading' OR 'research'".
            </p>
          }
        />
        <FAQItem
          question="Does deleting a list delete the content in it?"
          answer={
            <p>
              No. Deleting a list only removes the saved filter view. Your bookmarks and
              notes remain untouched. Lists are just a way to view your content - they
              don't own or contain the actual items.
            </p>
          }
        />
        <FAQItem
          question="What is a group?"
          answer={
            <p>
              Groups are organizational folders in the sidebar that help you organize your
              lists. You can drag lists into groups to keep your sidebar tidy. Groups are
              purely for organization - they don't affect how your content is filtered.
            </p>
          }
        />
        <FAQItem
          question="Does deleting a group delete the lists in it?"
          answer={
            <p>
              No. When you delete a group, the lists inside are moved back to the top level
              of the sidebar. Your lists and their filter settings are preserved.
            </p>
          }
        />
        <FAQItem
          question="Can a list contain both bookmarks and notes?"
          answer={
            <p>
              Yes. When creating or editing a list, you can choose which content types to
              include. You can have a list with just bookmarks, just notes, or both.
            </p>
          }
        />
      </FAQSection>

      <FAQSection title="Tags">
        <FAQItem
          question="Are tags shared between bookmarks and notes?"
          answer={
            <p>
              Yes. Tags are global across all content types. If you tag a bookmark with
              "work" and a note with "work", they share the same tag and will appear together
              in any list or search that filters by that tag.
            </p>
          }
        />
        <FAQItem
          question="What happens when I rename a tag?"
          answer={
            <p>
              Renaming a tag updates it everywhere - on all bookmarks and notes that use it,
              and in all list filters. It's a global rename across your entire account.
            </p>
          }
        />
        <FAQItem
          question="What happens when I delete a tag?"
          answer={
            <p>
              Deleting a tag removes it from all bookmarks and notes. The content itself is
              not deleted - only the tag association is removed. If a list filter depends on
              that tag, those items will no longer appear in that list.
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

      <FAQSection title="Search">
        <FAQItem
          question="What does search look through?"
          answer={
            <p>
              Search looks through titles, descriptions, URLs (for bookmarks), and the
              full page content. For bookmarks, the page content is automatically extracted
              when you save the URL. For notes, your markdown content is searched.
            </p>
          }
        />
        <FAQItem
          question="Can I combine search with tag filters?"
          answer={
            <p>
              Yes. You can search while viewing a specific list (which filters by tags),
              and the search will only look within items matching that list's filter.
              You can also add tag filters directly to your search.
            </p>
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
          question="What is MCP integration?"
          answer={
            <p>
              MCP (Model Context Protocol) allows AI assistants like Claude to interact with
              your bookmarks and notes. Once configured, you can ask Claude to search your
              bookmarks, create new ones, or help organize your content using natural language.
            </p>
          }
        />
      </FAQSection>
    </div>
  )
}
