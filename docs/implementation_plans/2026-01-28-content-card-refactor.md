# Implementation Plan: ContentCard Component Refactor

**Date:** 2026-01-28

## Overview

The three card components (`BookmarkCard`, `NoteCard`, `PromptCard`) share ~70% identical code for layout, actions, tags, and date display. This refactor extracts the common structure into a composable `ContentCard` component using the compound component pattern, eliminating duplication while preserving flexibility for entity-specific content.

## Problem Statement

**Current state:**
- `BookmarkCard.tsx`: 379 lines
- `NoteCard.tsx`: 246 lines
- `PromptCard.tsx`: 253 lines
- **Total: 878 lines** with significant duplication

**Duplicated across all three:**
- Card container with `card card-interactive group` styling
- Responsive flex layout (mobile stacked, desktop row)
- Tags section with `Tag` components and `AddTagButton`
- Action buttons section (Archive, Restore, Delete) with Tooltip wrappers
- Date display with `getDateDisplay()` logic
- Scheduled archive warning banner
- Click handling with `stopPropagation()`

**Entity-specific differences:**
- **BookmarkCard**: Favicon, URL display, Edit button, Copy URL button, `isLoading` state
- **NoteCard**: Version badge, CopyContentButton
- **PromptCard**: Arguments display, CopyContentButton

## Goals

1. **Eliminate duplication**: Single source of truth for card layout and common actions
2. **Composition over configuration**: Use compound components for flexibility
3. **Type safety**: Generic typing for entity-specific callbacks
4. **Maintainability**: Changes to card behavior only need to happen once
5. **Testability**: Shared components tested once, entity cards test only their specifics

## Non-Goals

- Changing UI/UX behavior
- Modifying the existing API or data structures
- Creating abstractions for entity-specific features (favicon, URL, etc.)

---

## Architecture

### Compound Component Pattern

The `ContentCard` will use React's compound component pattern, providing subcomponents that can be composed flexibly:

```tsx
<ContentCard
  entity={bookmark}
  view={view}
  onClick={handleCardClick}
>
  <ContentCard.Header>
    <ContentCard.Icon color={CONTENT_TYPE_ICON_COLORS.bookmark}>
      <BookmarkIcon />
    </ContentCard.Icon>
    <ContentCard.Title onClick={handleTitleClick}>
      {displayTitle}
    </ContentCard.Title>
    {/* Bookmark-specific: favicon and URL */}
    <Favicon url={bookmark.url} />
    <ContentCard.Subtitle>{urlDisplay}</ContentCard.Subtitle>
  </ContentCard.Header>

  <ContentCard.Description>{bookmark.description}</ContentCard.Description>

  <ContentCard.Tags
    tags={bookmark.tags}
    onTagClick={onTagClick}
    onTagRemove={onTagRemove ? (tag) => onTagRemove(bookmark, tag) : undefined}
  />

  <ContentCard.Actions>
    {/* Bookmark-specific actions */}
    <ContentCard.EditAction onClick={() => onEdit(bookmark)} isLoading={isLoading} />
    <ContentCard.CopyUrlAction url={bookmark.url} onCopy={handleCopyUrl} />
    {/* Shared actions - these read view from context */}
    <ContentCard.AddTagAction
      existingTags={bookmark.tags}
      suggestions={tagSuggestions}
      onAdd={(tag) => onTagAdd(bookmark, tag)}
    />
    <ContentCard.ArchiveAction onArchive={() => onArchive(bookmark)} />
    <ContentCard.RestoreAction onRestore={() => onRestore(bookmark)} />
    <ContentCard.DeleteAction onDelete={() => onDelete(bookmark)} />
  </ContentCard.Actions>

  <ContentCard.DateDisplay
    sortBy={sortBy}
    entity={bookmark}
  />

  <ContentCard.ScheduledArchive
    archivedAt={bookmark.archived_at}
    onCancel={() => onCancelScheduledArchive(bookmark)}
  />
</ContentCard>
```

### Context for View State

A `ContentCardContext` provides the `view` prop to child components so action buttons can conditionally render:

```typescript
interface ContentCardContextValue {
  view: 'active' | 'archived' | 'deleted'
}

const ContentCardContext = createContext<ContentCardContextValue | null>(null)
```

### File Structure

```
frontend/src/components/
├── ContentCard/
│   ├── index.ts                    # Barrel export
│   ├── ContentCard.tsx             # Main container + context provider
│   ├── ContentCardHeader.tsx       # Header with icon, title, subtitle
│   ├── ContentCardDescription.tsx  # Description/preview text
│   ├── ContentCardTags.tsx         # Tags section
│   ├── ContentCardActions.tsx      # Actions container
│   ├── ContentCardDateDisplay.tsx  # Date with sort-aware formatting
│   ├── ContentCardScheduledArchive.tsx  # Scheduled archive banner
│   ├── actions/
│   │   ├── index.ts
│   │   ├── AddTagAction.tsx
│   │   ├── ArchiveAction.tsx
│   │   ├── RestoreAction.tsx
│   │   ├── DeleteAction.tsx
│   │   ├── EditAction.tsx          # For BookmarkCard
│   │   └── CopyUrlAction.tsx       # For BookmarkCard
│   └── ContentCard.test.tsx
├── BookmarkCard.tsx                # Simplified, composes ContentCard
├── NoteCard.tsx                    # Simplified, composes ContentCard
└── PromptCard.tsx                  # Simplified, composes ContentCard
```

---

## Milestone 1: ContentCard Container and Context

### Goal
Create the foundational `ContentCard` component with context provider and basic container styling.

### Key Changes

**New file: `frontend/src/components/ContentCard/ContentCard.tsx`**

```typescript
interface ContentCardProps {
  view?: 'active' | 'archived' | 'deleted'
  onClick?: () => void
  children: ReactNode
  className?: string
}

interface ContentCardContextValue {
  view: 'active' | 'archived' | 'deleted'
}

const ContentCardContext = createContext<ContentCardContextValue | null>(null)

export function useContentCardContext(): ContentCardContextValue {
  const context = useContext(ContentCardContext)
  if (!context) {
    throw new Error('ContentCard subcomponents must be used within ContentCard')
  }
  return context
}

export function ContentCard({
  view = 'active',
  onClick,
  children,
  className = '',
}: ContentCardProps): ReactNode {
  return (
    <ContentCardContext.Provider value={{ view }}>
      <div
        className={`card card-interactive group ${onClick ? 'cursor-pointer' : ''} ${className}`}
        onClick={onClick}
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-4">
          {children}
        </div>
      </div>
    </ContentCardContext.Provider>
  )
}
```

**New file: `frontend/src/components/ContentCard/index.ts`**

Barrel export that will grow as we add subcomponents.

### Testing Strategy

**New file: `frontend/src/components/ContentCard/ContentCard.test.tsx`**

- Renders children
- Applies `cursor-pointer` class when `onClick` provided
- Calls `onClick` when clicked
- Context provides correct `view` value to children
- Throws error when `useContentCardContext` used outside provider

### Success Criteria
- ContentCard renders with correct styling
- Context provides view to children
- All tests pass
- `npm run lint` passes

### Dependencies
None

### Risk Factors
None - this is additive and doesn't modify existing components yet.

---

## Milestone 2: Header, Description, and Tags Subcomponents

### Goal
Create the header section subcomponents (Icon, Title, Subtitle), Description, and Tags.

### Key Changes

**New file: `frontend/src/components/ContentCard/ContentCardHeader.tsx`**

```typescript
// Container for the header row
export function ContentCardHeader({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="min-w-0 flex-1 overflow-hidden">
      <div className="flex items-center gap-2 md:flex-wrap">
        {children}
      </div>
    </div>
  )
}

// Icon wrapper with color prop
export function ContentCardIcon({
  children,
  color
}: {
  children: ReactNode
  color: string
}): ReactNode {
  return (
    <span className={`shrink-0 w-4 h-4 ${color}`}>
      {children}
    </span>
  )
}

// Clickable or static title
export function ContentCardTitle({
  children,
  onClick,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  title?: string
}): ReactNode {
  // Implementation handles both clickable button and static span cases
}

// Subtitle for secondary text (e.g., URL)
export function ContentCardSubtitle({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <span className={`text-sm text-gray-400 truncate min-w-0 ${className}`}>
      {children}
    </span>
  )
}
```

**New file: `frontend/src/components/ContentCard/ContentCardDescription.tsx`**

```typescript
export function ContentCardDescription({ children }: { children: ReactNode }): ReactNode {
  if (!children) return null
  return (
    <p className="mt-1 text-sm text-gray-500 line-clamp-2 md:line-clamp-1">
      {children}
    </p>
  )
}
```

**New file: `frontend/src/components/ContentCard/ContentCardTags.tsx`**

```typescript
interface ContentCardTagsProps {
  tags: string[]
  onTagClick?: (tag: string) => void
  onTagRemove?: (tag: string) => void
}

export function ContentCardTags({
  tags,
  onTagClick,
  onTagRemove,
}: ContentCardTagsProps): ReactNode {
  if (tags.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 flex-1 md:flex-initial md:justify-end md:w-32 md:shrink-0">
      {tags.map((tag) => (
        <Tag
          key={tag}
          tag={tag}
          onClick={onTagClick ? () => onTagClick(tag) : undefined}
          onRemove={onTagRemove ? () => onTagRemove(tag) : undefined}
        />
      ))}
    </div>
  )
}
```

### Testing Strategy

Tests for each subcomponent:
- `ContentCardHeader`: Renders children with correct layout
- `ContentCardIcon`: Applies color class
- `ContentCardTitle`: Renders as button when onClick provided, calls handler, stops propagation
- `ContentCardSubtitle`: Renders with correct styling
- `ContentCardDescription`: Renders children, returns null when empty
- `ContentCardTags`: Renders Tag components, calls onTagClick/onTagRemove correctly

### Success Criteria
- All subcomponents render correctly
- All tests pass
- Components are exported from barrel file

### Dependencies
- Milestone 1

### Risk Factors
- Title click handling needs to match existing behavior (stopPropagation)

---

## Milestone 3: Action Subcomponents

### Goal
Create the action button subcomponents that use context to conditionally render based on view.

### Key Changes

**New file: `frontend/src/components/ContentCard/ContentCardActions.tsx`**

Container for the actions row:

```typescript
export function ContentCardActions({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center gap-1 md:flex-col md:items-end shrink-0 ml-auto md:ml-0">
      <div className="flex items-center">
        {children}
      </div>
    </div>
  )
}
```

**New files in `frontend/src/components/ContentCard/actions/`:**

Each action component reads `view` from context and conditionally renders:

```typescript
// AddTagAction.tsx
interface AddTagActionProps {
  existingTags: string[]
  suggestions: TagCount[]
  onAdd: (tag: string) => void
}

export function AddTagAction({ existingTags, suggestions, onAdd }: AddTagActionProps): ReactNode {
  const { view } = useContentCardContext()
  if (view === 'deleted') return null
  if (!suggestions) return null

  return (
    <AddTagButton
      existingTags={existingTags}
      suggestions={suggestions}
      onAdd={onAdd}
    />
  )
}

// ArchiveAction.tsx
interface ArchiveActionProps {
  onArchive: () => void
}

export function ArchiveAction({ onArchive }: ArchiveActionProps): ReactNode {
  const { view } = useContentCardContext()
  if (view !== 'active') return null

  return (
    <Tooltip content="Archive" compact>
      <button
        onClick={(e) => { e.stopPropagation(); onArchive() }}
        className="btn-icon"
        aria-label="Archive"
      >
        <ArchiveIcon className="h-4 w-4" />
      </button>
    </Tooltip>
  )
}

// RestoreAction.tsx - handles both archived (unarchive) and deleted (restore) views
// DeleteAction.tsx - handles normal delete vs permanent delete in trash
// EditAction.tsx - for BookmarkCard only
// CopyUrlAction.tsx - for BookmarkCard only
```

### Testing Strategy

For each action component:
- Renders correctly in appropriate view(s)
- Returns null in inappropriate views
- Calls handler with stopPropagation
- DeleteAction shows ConfirmDeleteButton in deleted view

### Success Criteria
- All action components respect view context
- Correct tooltips and aria-labels
- All tests pass

### Dependencies
- Milestone 1 (context)
- Milestone 2 (structure)

### Risk Factors
- Need to ensure all stopPropagation calls are preserved
- DeleteAction has two modes (soft delete vs permanent delete)

---

## Milestone 4: DateDisplay and ScheduledArchive Subcomponents

### Goal
Create the date display and scheduled archive warning subcomponents.

### Key Changes

**New file: `frontend/src/components/ContentCard/ContentCardDateDisplay.tsx`**

```typescript
interface ContentCardDateDisplayProps {
  sortBy: SortByOption
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  archivedAt: string | null
  deletedAt: string | null
}

export function ContentCardDateDisplay({
  sortBy,
  createdAt,
  updatedAt,
  lastUsedAt,
  archivedAt,
  deletedAt,
}: ContentCardDateDisplayProps): ReactNode {
  const getDateDisplay = (): string => {
    switch (sortBy) {
      case 'updated_at':
        return `Modified: ${formatDate(updatedAt)}`
      case 'last_used_at':
        return `Used: ${formatDate(lastUsedAt)}`
      case 'archived_at':
        return `Archived: ${formatDate(archivedAt!)}`
      case 'deleted_at':
        return `Deleted: ${formatDate(deletedAt!)}`
      case 'created_at':
      case 'title':
      default:
        return `Created: ${formatDate(createdAt)}`
    }
  }

  return (
    <span className="text-xs text-gray-400">
      {getDateDisplay()}
    </span>
  )
}
```

**New file: `frontend/src/components/ContentCard/ContentCardScheduledArchive.tsx`**

```typescript
interface ContentCardScheduledArchiveProps {
  archivedAt: string | null
  onCancel?: () => void
}

export function ContentCardScheduledArchive({
  archivedAt,
  onCancel,
}: ContentCardScheduledArchiveProps): ReactNode {
  const { view } = useContentCardContext()

  // Only show in active view when archived_at is in the future
  const hasScheduledArchive = view === 'active' &&
    archivedAt &&
    new Date(archivedAt) > new Date()

  if (!hasScheduledArchive) return null

  return (
    <span className="flex items-center gap-1 text-xs text-amber-600">
      <span>Archiving: {formatDate(archivedAt)}</span>
      {onCancel && (
        <button
          onClick={(e) => { e.stopPropagation(); onCancel() }}
          className="text-amber-500 hover:text-amber-700 transition-colors p-0.5 -m-0.5"
          title="Cancel scheduled archive"
          aria-label="Cancel scheduled archive"
        >
          <CloseIcon className="w-3 h-3" />
        </button>
      )}
    </span>
  )
}
```

### Testing Strategy

- `ContentCardDateDisplay`: Correct label for each sortBy value
- `ContentCardScheduledArchive`:
  - Returns null when not in active view
  - Returns null when archived_at is in the past
  - Returns null when archived_at is null
  - Renders warning when archived_at is in the future
  - Cancel button calls handler with stopPropagation

### Success Criteria
- Date display matches existing behavior exactly
- Scheduled archive logic matches existing behavior
- All tests pass

### Dependencies
- Milestone 1 (context for view)

### Risk Factors
- Date comparison logic must handle timezone correctly (existing code works, preserve it)

---

## Milestone 5: Migrate NoteCard

### Goal
Refactor `NoteCard` to use `ContentCard` composition. NoteCard is chosen first because it's the simplest (no entity-specific features like favicon).

### Key Changes

**Modify: `frontend/src/components/NoteCard.tsx`**

Before: 246 lines with duplicated layout and action logic
After: ~80-100 lines composing ContentCard subcomponents

```tsx
export function NoteCard({
  note,
  view = 'active',
  sortBy = 'created_at',
  onView,
  onDelete,
  onArchive,
  onUnarchive,
  onRestore,
  onTagClick,
  onTagRemove,
  onTagAdd,
  tagSuggestions,
  onCancelScheduledArchive,
}: NoteCardProps): ReactNode {
  return (
    <ContentCard view={view} onClick={onView ? () => onView(note) : undefined}>
      <ContentCard.Header>
        <ContentCard.Icon color={CONTENT_TYPE_ICON_COLORS.note}>
          <NoteIcon className="w-4 h-4" />
        </ContentCard.Icon>
        <ContentCard.Title
          onClick={onView ? () => onView(note) : undefined}
          title="View note"
        >
          {truncate(note.title, 60)}
        </ContentCard.Title>
        {note.version > 1 && (
          <span className="text-xs text-gray-400 shrink-0">v{note.version}</span>
        )}
      </ContentCard.Header>

      <ContentCard.Description>{note.description}</ContentCard.Description>

      <ContentCard.Tags
        tags={note.tags}
        onTagClick={onTagClick}
        onTagRemove={onTagRemove ? (tag) => onTagRemove(note, tag) : undefined}
      />

      <ContentCard.Actions>
        {onTagAdd && tagSuggestions && (
          <ContentCard.AddTagAction
            existingTags={note.tags}
            suggestions={tagSuggestions}
            onAdd={(tag) => onTagAdd(note, tag)}
          />
        )}
        <CopyContentButton contentType="note" id={note.id} />
        {onArchive && <ContentCard.ArchiveAction onArchive={() => onArchive(note)} />}
        {onUnarchive && <ContentCard.RestoreAction onRestore={() => onUnarchive(note)} />}
        {onRestore && <ContentCard.RestoreAction onRestore={() => onRestore(note)} />}
        <ContentCard.DeleteAction onDelete={() => onDelete(note)} />
      </ContentCard.Actions>

      <ContentCard.DateDisplay
        sortBy={sortBy}
        createdAt={note.created_at}
        updatedAt={note.updated_at}
        lastUsedAt={note.last_used_at}
        archivedAt={note.archived_at}
        deletedAt={note.deleted_at}
      />

      {onCancelScheduledArchive && (
        <ContentCard.ScheduledArchive
          archivedAt={note.archived_at}
          onCancel={() => onCancelScheduledArchive(note)}
        />
      )}
    </ContentCard>
  )
}
```

### Testing Strategy

**Existing tests in `NoteCard.test.tsx` should pass unchanged.** This validates the refactor preserves behavior.

Additional tests:
- Verify version badge still renders when version > 1
- Verify CopyContentButton still renders correctly

### Success Criteria
- All existing `NoteCard.test.tsx` tests pass without modification
- Visual appearance unchanged
- Line count reduced from 246 to ~80-100

### Dependencies
- Milestones 1-4

### Risk Factors
- Must ensure exact same DOM structure for styling to work
- Click handlers must propagate correctly

---

## Milestone 6: Migrate PromptCard

### Goal
Refactor `PromptCard` to use `ContentCard` composition.

### Key Changes

**Modify: `frontend/src/components/PromptCard.tsx`**

Similar to NoteCard migration. PromptCard has arguments display which stays as entity-specific content.

### Testing Strategy

**Existing tests in `PromptCard.test.tsx` should pass unchanged.**

### Success Criteria
- All existing `PromptCard.test.tsx` tests pass
- Arguments display preserved
- Line count reduced from 253 to ~80-100

### Dependencies
- Milestone 5 (validates the pattern works)

### Risk Factors
- Arguments display may need special handling in header

---

## Milestone 7: Migrate BookmarkCard

### Goal
Refactor `BookmarkCard` to use `ContentCard` composition. This is the most complex card with Edit, Copy URL, favicon, and URL display.

### Key Changes

**Modify: `frontend/src/components/BookmarkCard.tsx`**

BookmarkCard has several entity-specific features:
- Favicon rendering
- URL display (inline on desktop, below title on mobile)
- Edit button with isLoading state
- Copy URL button (different from CopyContentButton)

These will use generic ContentCard subcomponents where possible and entity-specific JSX where not.

### Testing Strategy

**Existing tests in `BookmarkCard.test.tsx` should pass unchanged.**

Additional verification:
- Edit button isLoading state works
- Copy URL feedback (success checkmark) works
- Favicon error fallback works

### Success Criteria
- All existing `BookmarkCard.test.tsx` tests pass
- All bookmark-specific features preserved
- Line count reduced from 379 to ~120-150

### Dependencies
- Milestone 6

### Risk Factors
- Most complex card, highest risk of regression
- Copy URL state management stays in BookmarkCard (not extracted)

---

## Milestone 8: Cleanup and Documentation

### Goal
Remove any dead code, update documentation, ensure consistent patterns.

### Key Changes

1. Remove any unused imports from card components
2. Update component JSDoc comments
3. Add README or comments explaining the ContentCard pattern
4. Verify all barrel exports are correct

### Testing Strategy

- `npm run lint` passes
- `npm run test:run` passes
- Manual visual review of all card types in all views

### Success Criteria
- No lint warnings
- All tests pass
- Clean, documented code

### Dependencies
- Milestones 5-7

### Risk Factors
None

---

## Summary

| Milestone | Goal | Est. Lines Changed |
|-----------|------|-------------------|
| 1 | ContentCard container + context | +80 |
| 2 | Header, Description, Tags subcomponents | +120 |
| 3 | Action subcomponents | +150 |
| 4 | DateDisplay, ScheduledArchive | +60 |
| 5 | Migrate NoteCard | -150 |
| 6 | Migrate PromptCard | -150 |
| 7 | Migrate BookmarkCard | -200 |
| 8 | Cleanup | +20 |

**Net result:** ~410 new lines for ContentCard, ~500 lines removed from card components = **~90 lines reduction** with significantly improved maintainability.

The real win is not line count but **single source of truth** - future changes to card layout, action buttons, or date display only need to happen in one place.
