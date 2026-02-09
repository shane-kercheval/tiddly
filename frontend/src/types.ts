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
  id: string
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
  content_preview: string | null  // First 500 chars of content (whitespace normalized)
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
  expected_updated_at?: string  // ISO 8601 timestamp for optimistic locking. If provided and entity was modified after this time, returns 409 Conflict.
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
  id: string
  title: string
  description: string | null
  tags: string[]
  created_at: string
  updated_at: string
  last_used_at: string
  deleted_at: string | null
  archived_at: string | null
  version: number
  content_preview: string | null  // First 500 chars of content (whitespace normalized)
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
  expected_updated_at?: string  // ISO 8601 timestamp for optimistic locking. If provided and entity was modified after this time, returns 409 Conflict.
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
  filter_id?: string
}

/** Tag with usage counts */
export interface TagCount {
  name: string
  content_count: number  // Count of bookmarks + notes + prompts using this tag
  filter_count: number   // Count of filters using this tag
}

/** Tags list response from GET /tags/ */
export interface TagListResponse {
  tags: TagCount[]
}

/** Full tag object returned by rename endpoint */
export interface Tag {
  id: string
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
  filter_id?: string
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
  id: string
  title: string | null
  description: string | null
  tags: string[]
  created_at: string
  updated_at: string
  last_used_at: string
  deleted_at: string | null
  archived_at: string | null
  content_preview: string | null  // First 500 chars of content (whitespace normalized)
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
  filter_id?: string
  content_types?: ContentType[]
}

// =============================================================================
// ContentFilter Types
// =============================================================================

/** Valid content types for filters */
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

/** ContentFilter data returned from the API */
export interface ContentFilter {
  id: string
  name: string
  content_types: ContentType[]
  filter_expression: FilterExpression
  default_sort_by: string | null
  default_sort_ascending: boolean | null
  created_at: string
  updated_at: string
}

/** Data for creating a new content filter */
export interface ContentFilterCreate {
  name: string
  content_types?: ContentType[]  // Defaults to ["bookmark", "note"]
  filter_expression: FilterExpression
  default_sort_by?: string | null
  default_sort_ascending?: boolean | null
}

/** Data for updating an existing content filter */
export interface ContentFilterUpdate {
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

/** A user-created filter item in the sidebar (input format) */
export interface SidebarFilterItem {
  type: 'filter'
  id: string
}

/** A collection containing other items in the sidebar (input format) */
export interface SidebarCollection {
  type: 'collection'
  id: string // UUID, generated client-side via crypto.randomUUID()
  name: string
  items: (SidebarFilterItem | SidebarBuiltinItem)[]
}

/** Any sidebar item (input format) */
export type SidebarItem = SidebarBuiltinItem | SidebarFilterItem | SidebarCollection

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

/** A filter item with name and content types resolved from database */
export interface SidebarFilterItemComputed extends SidebarFilterItem {
  name: string
  content_types: ContentType[]
}

/** A collection with resolved child items */
export interface SidebarCollectionComputed {
  type: 'collection'
  id: string
  name: string
  items: (SidebarFilterItemComputed | SidebarBuiltinItemComputed)[]
}

/** Any computed sidebar item */
export type SidebarItemComputed =
  | SidebarBuiltinItemComputed
  | SidebarFilterItemComputed
  | SidebarCollectionComputed

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
  id: string
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
  id: string
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
  content_preview: string | null  // First 500 chars of content (whitespace normalized)
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
  expected_updated_at?: string  // ISO 8601 timestamp for optimistic locking. If provided and entity was modified after this time, returns 409 Conflict.
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
  filter_id?: string
}

/** Request for rendering a prompt with arguments */
export interface PromptRenderRequest {
  arguments: Record<string, unknown>
}

/** Response from prompt render endpoint */
export interface PromptRenderResponse {
  rendered_content: string
}

// =============================================================================
// User Limits Types
// =============================================================================

/** User tier limits returned from GET /users/me/limits */
export interface UserLimits {
  tier: string

  // Item counts
  max_bookmarks: number
  max_notes: number
  max_prompts: number

  // Field lengths (common)
  max_title_length: number
  max_description_length: number
  max_tag_name_length: number

  // Field lengths (content - per entity type)
  max_bookmark_content_length: number
  max_note_content_length: number
  max_prompt_content_length: number

  // Field lengths (entity-specific)
  max_url_length: number
  max_prompt_name_length: number
  max_argument_name_length: number
  max_argument_description_length: number

  // Rate limits
  rate_read_per_minute: number
  rate_read_per_day: number
  rate_write_per_minute: number
  rate_write_per_day: number
  rate_sensitive_per_minute: number
  rate_sensitive_per_day: number
}

// =============================================================================
// History Types
// =============================================================================

/** Entity type for history records */
export type HistoryEntityType = 'bookmark' | 'note' | 'prompt'

/** Action types tracked in history */
export type HistoryActionType = 'create' | 'update' | 'delete' | 'restore' | 'undelete' | 'archive' | 'unarchive'

/** Source types for history records (matches backend RequestSource enum) */
export type HistorySourceType = 'web' | 'api' | 'mcp-content' | 'mcp-prompt' | 'unknown'

/** Single history record */
export interface HistoryEntry {
  id: string
  entity_type: HistoryEntityType
  entity_id: string
  action: HistoryActionType
  version: number | null
  metadata_snapshot: Record<string, unknown> | null
  source: HistorySourceType
  auth_type: string
  token_prefix: string | null
  created_at: string
}

/** Paginated history list response */
export interface HistoryListResponse {
  items: HistoryEntry[]
  total: number
  offset: number
  limit: number
  has_more: boolean
}

/** Content at a specific version */
export interface ContentAtVersionResponse {
  entity_id: string
  version: number
  content: string | null
  metadata: Record<string, unknown> | null
  warnings: string[] | null
}

/** Diff between a version and its predecessor */
export interface VersionDiffResponse {
  entity_id: string
  version: number
  before_content: string | null
  after_content: string | null
  before_metadata: Record<string, unknown> | null
  after_metadata: Record<string, unknown> | null
  warnings: string[] | null
}

/** Response from restore operation */
export interface RestoreResponse {
  message: string
  version: number
  warnings: string[] | null
}
