/**
 * TypeScript types for API responses and data models.
 */

/**
 * Bookmark item in list responses (excludes content for performance).
 *
 * The content field can be up to 500KB per bookmark, making list responses
 * unnecessarily large. Use GET /bookmarks/:id to fetch full bookmark with content.
 */
export interface BookmarkListItem {
  id: number
  url: string
  title: string | null
  description: string | null
  summary: string | null
  tags: string[]
  created_at: string
  updated_at: string
  last_used_at: string
  deleted_at: string | null
  archived_at: string | null
}

/**
 * Full bookmark data (includes content).
 *
 * Returned by GET /bookmarks/:id and mutation endpoints.
 */
export interface Bookmark extends BookmarkListItem {
  content: string | null
}

/** Data for creating a new bookmark */
export interface BookmarkCreate {
  url: string
  title?: string | null
  description?: string | null
  content?: string | null
  tags?: string[]
  archived_at?: string | null  // ISO 8601 datetime string for scheduling auto-archive
}

/** Data for updating an existing bookmark */
export interface BookmarkUpdate {
  url?: string
  title?: string | null
  description?: string | null
  content?: string | null
  tags?: string[]
  archived_at?: string | null  // ISO 8601 datetime string, or null to cancel schedule
}

/** Paginated list response from GET /bookmarks/ */
export interface BookmarkListResponse {
  items: BookmarkListItem[]
  total: number
  offset: number
  limit: number
  has_more: boolean
}

/** Metadata preview response from GET /bookmarks/fetch-metadata */
export interface MetadataPreviewResponse {
  url: string
  final_url: string
  title: string | null
  description: string | null
  content: string | null
  error: string | null
}

// =============================================================================
// Note Types
// =============================================================================

/**
 * Note item in list responses (excludes content for performance).
 *
 * The content field can be up to 2MB per note, making list responses
 * unnecessarily large. Use GET /notes/:id to fetch full note with content.
 */
export interface NoteListItem {
  id: number
  title: string
  description: string | null
  tags: string[]
  created_at: string
  updated_at: string
  last_used_at: string
  deleted_at: string | null
  archived_at: string | null
  version: number
}

/**
 * Full note data (includes content).
 *
 * Returned by GET /notes/:id and mutation endpoints.
 */
export interface Note extends NoteListItem {
  content: string | null
}

/** Data for creating a new note */
export interface NoteCreate {
  title: string  // Required for notes
  description?: string | null
  content?: string | null
  tags?: string[]
  archived_at?: string | null  // ISO 8601 datetime string for scheduling auto-archive
}

/** Data for updating an existing note */
export interface NoteUpdate {
  title?: string
  description?: string | null
  content?: string | null
  tags?: string[]
  archived_at?: string | null  // ISO 8601 datetime string, or null to cancel schedule
}

/** Paginated list response from GET /notes/ */
export interface NoteListResponse {
  items: NoteListItem[]
  total: number
  offset: number
  limit: number
  has_more: boolean
}

/** Search and filter parameters for listing notes */
export interface NoteSearchParams {
  q?: string
  tags?: string[]
  tag_match?: 'all' | 'any'
  sort_by?: 'created_at' | 'updated_at' | 'last_used_at' | 'title' | 'archived_at' | 'deleted_at'
  sort_order?: 'asc' | 'desc'
  offset?: number
  limit?: number
  view?: 'active' | 'archived' | 'deleted'
  list_id?: number
}

/** Tag with usage count */
export interface TagCount {
  name: string
  count: number
}

/** Tags list response from GET /tags/ */
export interface TagListResponse {
  tags: TagCount[]
}

/** Full tag object returned by rename endpoint */
export interface Tag {
  id: number
  name: string
  created_at: string
}

/** Request body for renaming a tag */
export interface TagRenameRequest {
  new_name: string
}

/** Search and filter parameters for listing bookmarks */
export interface BookmarkSearchParams {
  q?: string
  tags?: string[]
  tag_match?: 'all' | 'any'
  sort_by?: 'created_at' | 'updated_at' | 'last_used_at' | 'title' | 'archived_at' | 'deleted_at'
  sort_order?: 'asc' | 'desc'
  offset?: number
  limit?: number
  view?: 'active' | 'archived' | 'deleted'
  list_id?: number
}

// =============================================================================
// Unified Content Types (for shared views)
// =============================================================================

/**
 * Unified content item for list views.
 *
 * This type represents bookmarks, notes, and prompts in a unified format.
 * The `type` field indicates the content type, and type-specific fields
 * may be null for other types.
 */
export interface ContentListItem {
  type: 'bookmark' | 'note' | 'prompt'
  id: number
  title: string | null
  description: string | null
  tags: string[]
  created_at: string
  updated_at: string
  last_used_at: string
  deleted_at: string | null
  archived_at: string | null
  // Bookmark-specific (null for notes/prompts)
  url: string | null
  // Note-specific (null for bookmarks/prompts)
  version: number | null
  // Prompt-specific (null for bookmarks/notes)
  name: string | null
  arguments: PromptArgument[] | null
}

/** Paginated list response from GET /content/ */
export interface ContentListResponse {
  items: ContentListItem[]
  total: number
  offset: number
  limit: number
  has_more: boolean
}

/** Search and filter parameters for listing all content */
export interface ContentSearchParams {
  q?: string
  tags?: string[]
  tag_match?: 'all' | 'any'
  sort_by?: 'created_at' | 'updated_at' | 'last_used_at' | 'title' | 'archived_at' | 'deleted_at'
  sort_order?: 'asc' | 'desc'
  offset?: number
  limit?: number
  view?: 'active' | 'archived' | 'deleted'
  list_id?: number
  content_types?: ContentType[]
}

// =============================================================================
// ContentList Types
// =============================================================================

/** Valid content types for lists */
export type ContentType = 'bookmark' | 'note' | 'prompt'

/** A group of tags combined with AND logic */
export interface FilterGroup {
  tags: string[]
  operator: 'AND'
}

/** Filter expression with AND groups combined by OR */
export interface FilterExpression {
  groups: FilterGroup[]
  group_operator: 'OR'
}

/** ContentList data returned from the API */
export interface ContentList {
  id: number
  name: string
  content_types: ContentType[]
  filter_expression: FilterExpression
  default_sort_by: string | null
  default_sort_ascending: boolean | null
  created_at: string
  updated_at: string
}

/** Data for creating a new content list */
export interface ContentListCreate {
  name: string
  content_types?: ContentType[]  // Defaults to ["bookmark", "note"]
  filter_expression: FilterExpression
  default_sort_by?: string | null
  default_sort_ascending?: boolean | null
}

/** Data for updating an existing content list */
export interface ContentListUpdate {
  name?: string
  content_types?: ContentType[]
  filter_expression?: FilterExpression
  default_sort_by?: string | null
  default_sort_ascending?: boolean | null
}


// =============================================================================
// Sidebar Types
// =============================================================================

/** Valid built-in sidebar item keys */
export type BuiltinKey = 'all' | 'archived' | 'trash'

/** A built-in sidebar navigation item (input format) */
export interface SidebarBuiltinItem {
  type: 'builtin'
  key: BuiltinKey
}

/** A user-created list item in the sidebar (input format) */
export interface SidebarListItem {
  type: 'list'
  id: number
}

/** A group containing other items in the sidebar (input format) */
export interface SidebarGroup {
  type: 'group'
  id: string // UUID, generated client-side via crypto.randomUUID()
  name: string
  items: (SidebarListItem | SidebarBuiltinItem)[]
}

/** Any sidebar item (input format) */
export type SidebarItem = SidebarBuiltinItem | SidebarListItem | SidebarGroup

/** Complete sidebar structure (input format for PUT) */
export interface SidebarOrder {
  version: number
  items: SidebarItem[]
}

// Computed versions (from GET response)

/** A built-in item with display name resolved */
export interface SidebarBuiltinItemComputed extends SidebarBuiltinItem {
  name: string // "All", "Archived", "Trash"
}

/** A list item with name and content types resolved from database */
export interface SidebarListItemComputed extends SidebarListItem {
  name: string
  content_types: string[]
}

/** A group with resolved child items */
export interface SidebarGroupComputed {
  type: 'group'
  id: string
  name: string
  items: (SidebarListItemComputed | SidebarBuiltinItemComputed)[]
}

/** Any computed sidebar item */
export type SidebarItemComputed =
  | SidebarBuiltinItemComputed
  | SidebarListItemComputed
  | SidebarGroupComputed

/** Complete sidebar structure with resolved names (from GET response) */
export interface SidebarOrderComputed {
  version: number
  items: SidebarItemComputed[]
}

// =============================================================================
// Token Types
// =============================================================================

/** API Token (PAT) data returned from the API */
export interface Token {
  id: number
  name: string
  token_prefix: string
  last_used_at: string | null
  expires_at: string | null
  created_at: string
}

/** Token creation response includes the plaintext token */
export interface TokenCreateResponse extends Token {
  token: string
}

/** Data for creating a new token */
export interface TokenCreate {
  name: string
  expires_in_days?: number
}

// =============================================================================
// Prompt Types
// =============================================================================

/**
 * Prompt argument definition.
 * Argument names must be valid Jinja2 identifiers (lowercase with underscores).
 */
export interface PromptArgument {
  name: string
  description: string | null
  required: boolean | null  // null treated as false
}

/**
 * Prompt item in list responses (excludes content for performance).
 */
export interface PromptListItem {
  id: number
  name: string
  title: string | null
  description: string | null
  arguments: PromptArgument[]  // Needed for display and MCP
  tags: string[]
  created_at: string
  updated_at: string
  last_used_at: string
  deleted_at: string | null
  archived_at: string | null
}

/**
 * Full prompt data (includes content).
 * Content is a Jinja2 template.
 */
export interface Prompt extends PromptListItem {
  content: string | null
}

/** Data for creating a new prompt */
export interface PromptCreate {
  name: string  // Required, lowercase with hyphens
  title?: string | null
  description?: string | null
  content?: string | null
  arguments?: PromptArgument[]
  tags?: string[]
  archived_at?: string | null
}

/** Data for updating an existing prompt */
export interface PromptUpdate {
  name?: string
  title?: string | null
  description?: string | null
  content?: string | null
  arguments?: PromptArgument[]
  tags?: string[]
  archived_at?: string | null
}

/** Paginated list response from GET /prompts/ */
export interface PromptListResponse {
  items: PromptListItem[]
  total: number
  offset: number
  limit: number
  has_more: boolean
}

/** Search and filter parameters for listing prompts */
export interface PromptSearchParams {
  q?: string
  tags?: string[]
  tag_match?: 'all' | 'any'
  sort_by?: 'created_at' | 'updated_at' | 'last_used_at' | 'title' | 'archived_at' | 'deleted_at'
  sort_order?: 'asc' | 'desc'
  offset?: number
  limit?: number
  view?: 'active' | 'archived' | 'deleted'
  list_id?: number
}
