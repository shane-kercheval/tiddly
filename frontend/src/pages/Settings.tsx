/**
 * Settings page - manage personal access tokens, lists, and tab order.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import toast from 'react-hot-toast'
import { useTokensStore } from '../stores/tokensStore'
import { useListsStore } from '../stores/listsStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTagsStore } from '../stores/tagsStore'
import { TokenList } from '../components/TokenList'
import { CreateTokenModal } from '../components/CreateTokenModal'
import { ListManager } from '../components/ListManager'
import { TabOrderEditor } from '../components/TabOrderEditor'
import type { TokenCreate, TokenCreateResponse, BookmarkListCreate, BookmarkListUpdate, BookmarkList } from '../types'

/**
 * Section wrapper component for consistent styling.
 */
interface SectionProps {
  title: string
  description?: string
  children: ReactNode
}

function Section({ title, description, children }: SectionProps): ReactNode {
  return (
    <section className="mb-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

/**
 * Settings page component.
 *
 * Features:
 * - Personal Access Token (PAT) management
 * - Bookmark lists creation and editing
 * - Tab order customization
 */
export function Settings(): ReactNode {
  const { tokens, isLoading: tokensLoading, fetchTokens, createToken, deleteToken } = useTokensStore()
  const { lists, isLoading: listsLoading, fetchLists, createList, updateList, deleteList } = useListsStore()
  const { computedTabOrder, isLoading: settingsLoading, fetchTabOrder, updateSettings } = useSettingsStore()
  const { tags, fetchTags } = useTagsStore()

  // Modal state
  const [showCreateToken, setShowCreateToken] = useState(false)

  // Fetch data on mount
  useEffect(() => {
    fetchTokens()
    fetchLists()
    fetchTabOrder()
    fetchTags()
  }, [fetchTokens, fetchLists, fetchTabOrder, fetchTags])

  // Token handlers
  const handleCreateToken = async (data: TokenCreate): Promise<TokenCreateResponse> => {
    const response = await createToken(data)
    toast.success(`Token "${data.name}" created`)
    return response
  }

  const handleDeleteToken = async (id: number): Promise<void> => {
    try {
      await deleteToken(id)
      toast.success('Token deleted')
    } catch {
      toast.error('Failed to delete token')
      throw new Error('Failed to delete token')
    }
  }

  // List handlers
  const handleCreateList = async (data: BookmarkListCreate): Promise<BookmarkList> => {
    try {
      const response = await createList(data)
      // Refresh tab order since new list was added
      fetchTabOrder()
      toast.success(`List "${data.name}" created`)
      return response
    } catch {
      toast.error('Failed to create list')
      throw new Error('Failed to create list')
    }
  }

  const handleUpdateList = async (id: number, data: BookmarkListUpdate): Promise<BookmarkList> => {
    try {
      const response = await updateList(id, data)
      // Refresh tab order in case name changed
      fetchTabOrder()
      toast.success('List updated')
      return response
    } catch {
      toast.error('Failed to update list')
      throw new Error('Failed to update list')
    }
  }

  const handleDeleteList = async (id: number): Promise<void> => {
    try {
      await deleteList(id)
      // Refresh tab order since list was removed
      fetchTabOrder()
      toast.success('List deleted')
    } catch {
      toast.error('Failed to delete list')
      throw new Error('Failed to delete list')
    }
  }

  // Tab order handlers
  const handleSaveTabOrder = async (tabOrder: string[]): Promise<void> => {
    try {
      await updateSettings({ tab_order: tabOrder })
      // Refresh to get the updated computed tab order
      fetchTabOrder()
      toast.success('Tab order saved')
    } catch {
      toast.error('Failed to save tab order')
      throw new Error('Failed to save tab order')
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-gray-500">
          Manage your account settings and preferences.
        </p>
      </div>

      {/* Personal Access Tokens Section */}
      <Section
        title="Personal Access Tokens"
        description="Create tokens for API access. Tokens are shown only once when created."
      >
        <TokenList
          tokens={tokens}
          isLoading={tokensLoading}
          onDelete={handleDeleteToken}
          onCreateClick={() => setShowCreateToken(true)}
        />
      </Section>

      {/* Bookmark Lists Section */}
      <Section
        title="Bookmark Lists"
        description="Create custom lists based on tag filters. Lists appear as tabs on the bookmarks page."
      >
        <ListManager
          lists={lists}
          isLoading={listsLoading}
          tagSuggestions={tags}
          onCreate={handleCreateList}
          onUpdate={handleUpdateList}
          onDelete={handleDeleteList}
        />
      </Section>

      {/* Tab Order Section */}
      <Section
        title="Tab Order"
        description="Customize the order of tabs on the bookmarks page."
      >
        <TabOrderEditor
          items={computedTabOrder}
          isLoading={settingsLoading}
          onSave={handleSaveTabOrder}
        />
      </Section>

      {/* Create Token Modal */}
      <CreateTokenModal
        isOpen={showCreateToken}
        onClose={() => setShowCreateToken(false)}
        onCreate={handleCreateToken}
      />
    </div>
  )
}
