# Implementation Plan: ContentCard Component Refactor

**Date:** 2026-01-28
**Revised:** 2026-01-28 (v2 - simplified, no Header extraction)

## Overview

The three card components (`BookmarkCard`, `NoteCard`, `PromptCard`) share significant duplicated code for actions, tags, date display, and scheduled archive banners. This refactor extracts the **truly shared** parts into a composable `ContentCard` component using the compound component pattern.

**Key decision:** Headers are NOT extracted. Each card has unique header requirements (BookmarkCard's `showContentTypeIcon` toggle, favicon logic, URL links; NoteCard's version badge; PromptCard's name/title display). Forcing these into a generic abstraction creates more problems than it solves.

**Why now:** A 4th content type ("task") is planned. Without this refactor, adding TaskCard means copying ~250 lines and maintaining 4 parallel implementations of identical action/tag/date logic.

## Problem Statement

**Current state:**
- `BookmarkCard.tsx`: 379 lines
- `NoteCard.tsx`: 246 lines
- `PromptCard.tsx`: 253 lines
- **Total: 878 lines** with significant duplication

**Duplicated across all three (extract these):**
- Card container with `card card-interactive group` styling
- Tags section with `Tag` components
- Action buttons section (AddTag, Archive, Restore, Delete) with Tooltip wrappers
- Date display with `getDateDisplay()` logic
- Scheduled archive warning banner
- Click handling with `stopPropagation()`

**Entity-specific (keep in each card):**
- **BookmarkCard**: Header with `showContentTypeIcon` toggle, favicon, URL display, Edit button, Copy URL button, link click tracking
- **NoteCard**: Header with version badge, CopyContentButton
- **PromptCard**: Header with name/title display, arguments display, CopyContentButton

## Goals

1. **Eliminate duplication**: Single source of truth for shared card behavior
2. **Composition over configuration**: Compound components for flexibility
3. **Type safety**: Proper typing for callbacks
4. **Maintainability**: Changes to shared behavior happen once
5. **Easy to add new content types**: TaskCard can compose ContentCard subcomponents

## Non-Goals

- Extracting headers (too much variation between cards)
- Changing UI/UX behavior
- Modifying existing API or data structures

---

## Architecture

### Compound Component Pattern

The `ContentCard` provides a container and context, with subcomponents for shared UI:

```tsx
export function NoteCard({ note, view, sortBy, onView, onDelete, ... }: NoteCardProps): ReactNode {
  return (
    <ContentCard view={view} onClick={onView ? () => onView(note) : undefined}>
      {/* Header stays in NoteCard - entity-specific */}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-2 md:flex-wrap">
          <span className={`shrink-0 w-4 h-4 ${CONTENT_TYPE_ICON_COLORS.note}`}>
            <NoteIcon className="w-4 h-4" />
          </span>
          <button onClick={handleTitleClick} className="...">
            {truncate(note.title, 60)}
          </button>
          {note.version > 1 && (
            <span className="text-xs text-gray-400 shrink-0">v{note.version}</span>
          )}
        </div>
        {note.description && (
          <p className="mt-1 text-sm text-gray-500 line-clamp-2 md:line-clamp-1">
            {note.description}
          </p>
        )}
      </div>

      {/* Shared subcomponents */}
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
        {view !== 'deleted' && (
          <CopyContentButton contentType="note" id={note.id} />
        )}
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

### Context for View State

A `ContentCardContext` provides the `view` prop to child components so action buttons can conditionally render:

```typescript
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
```

### File Structure

```
frontend/src/components/
├── ContentCard/
│   ├── index.ts                    # Barrel export
│   ├── ContentCard.tsx             # Main container + context provider
│   ├── ContentCardTags.tsx         # Tags section
│   ├── ContentCardActions.tsx      # Actions container
│   ├── ContentCardDateDisplay.tsx  # Date with sort-aware formatting
│   ├── ContentCardScheduledArchive.tsx  # Scheduled archive banner
│   ├── actions/
│   │   ├── index.ts
│   │   ├── AddTagAction.tsx
│   │   ├── ArchiveAction.tsx
│   │   ├── RestoreAction.tsx
│   │   └── DeleteAction.tsx
│   └── ContentCard.test.tsx
├── BookmarkCard.tsx                # Composes ContentCard (keeps header + bookmark-specific)
├── NoteCard.tsx                    # Composes ContentCard (keeps header + note-specific)
└── PromptCard.tsx                  # Composes ContentCard (keeps header + prompt-specific)
```

---

## Milestone 1: ContentCard Container and Context

### Goal
Create the foundational `ContentCard` component with context provider and basic container styling.

### Key Changes

**New file: `frontend/src/components/ContentCard/ContentCard.tsx`**

```typescript
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

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

---

## Milestone 2: Tags and DateDisplay Subcomponents

### Goal
Create the Tags section and DateDisplay subcomponents.

### Key Changes

**New file: `frontend/src/components/ContentCard/ContentCardTags.tsx`**

```typescript
import type { ReactNode } from 'react'
import { Tag } from '../Tag'

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
    <div className="flex flex-wrap gap-1 md:justify-end md:w-32 md:shrink-0">
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

**New file: `frontend/src/components/ContentCard/ContentCardDateDisplay.tsx`**

```typescript
import type { ReactNode } from 'react'
import type { SortByOption } from '../../constants/sortOptions'
import { formatDate } from '../../utils'

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

### Testing Strategy

- `ContentCardTags`: Renders Tag components, returns null when empty, calls handlers correctly
- `ContentCardDateDisplay`: Correct label for each sortBy value

### Success Criteria
- All subcomponents render correctly
- All tests pass
- Components are exported from barrel file

### Dependencies
- Milestone 1

---

## Milestone 3: Action Subcomponents

### Goal
Create the action button subcomponents that use context to conditionally render based on view.

### Key Changes

**New file: `frontend/src/components/ContentCard/ContentCardActions.tsx`**

```typescript
import type { ReactNode } from 'react'

interface ContentCardActionsProps {
  children: ReactNode
}

export function ContentCardActions({ children }: ContentCardActionsProps): ReactNode {
  return (
    <div className="flex items-center justify-between w-full md:w-auto md:flex-col md:items-end md:shrink-0">
      <div className="flex items-center">
        {children}
      </div>
    </div>
  )
}
```

**New files in `frontend/src/components/ContentCard/actions/`:**

```typescript
// AddTagAction.tsx
import type { ReactNode } from 'react'
import { useContentCardContext } from '../ContentCard'
import { AddTagButton } from '../../AddTagButton'
import type { TagCount } from '../../../types'

interface AddTagActionProps {
  existingTags: string[]
  suggestions: TagCount[]
  onAdd: (tag: string) => void
}

export function AddTagAction({ existingTags, suggestions, onAdd }: AddTagActionProps): ReactNode {
  const { view } = useContentCardContext()
  if (view === 'deleted') return null

  return (
    <AddTagButton
      existingTags={existingTags}
      suggestions={suggestions}
      onAdd={onAdd}
    />
  )
}
```

```typescript
// ArchiveAction.tsx
import type { ReactNode } from 'react'
import { useContentCardContext } from '../ContentCard'
import { Tooltip } from '../../ui'
import { ArchiveIcon } from '../../icons'

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
```

```typescript
// RestoreAction.tsx
import type { ReactNode } from 'react'
import { Tooltip } from '../../ui'
import { RestoreIcon } from '../../icons'

interface RestoreActionProps {
  onRestore: () => void
}

export function RestoreAction({ onRestore }: RestoreActionProps): ReactNode {
  // Note: Does not check view - caller decides when to render
  // Used for both "unarchive" (archived view) and "restore" (deleted view)
  return (
    <Tooltip content="Restore" compact>
      <button
        onClick={(e) => { e.stopPropagation(); onRestore() }}
        className="btn-icon"
        aria-label="Restore"
      >
        <RestoreIcon />
      </button>
    </Tooltip>
  )
}
```

```typescript
// DeleteAction.tsx
import type { ReactNode } from 'react'
import { useContentCardContext } from '../ContentCard'
import { ConfirmDeleteButton, Tooltip } from '../../ui'
import { TrashIcon } from '../../icons'

interface DeleteActionProps {
  onDelete: () => void
}

export function DeleteAction({ onDelete }: DeleteActionProps): ReactNode {
  const { view } = useContentCardContext()

  // Permanent delete in trash view requires confirmation
  if (view === 'deleted') {
    return (
      <span onClick={(e) => e.stopPropagation()}>
        <ConfirmDeleteButton
          onConfirm={onDelete}
          title="Delete permanently"
        />
      </span>
    )
  }

  // Soft delete in other views
  return (
    <Tooltip content="Delete" compact>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="btn-icon-danger"
        aria-label="Delete"
      >
        <TrashIcon />
      </button>
    </Tooltip>
  )
}
```

### Testing Strategy

For each action component:
- Renders correctly in appropriate view(s)
- Returns null in inappropriate views (ArchiveAction, AddTagAction)
- Calls handler with stopPropagation
- DeleteAction shows ConfirmDeleteButton in deleted view

### Success Criteria
- All action components respect view context where applicable
- Correct tooltips and aria-labels
- All tests pass

### Dependencies
- Milestone 1 (context)

---

## Milestone 4: ScheduledArchive Subcomponent

### Goal
Create the scheduled archive warning banner subcomponent.

### Key Changes

**New file: `frontend/src/components/ContentCard/ContentCardScheduledArchive.tsx`**

```typescript
import type { ReactNode } from 'react'
import { useContentCardContext } from './ContentCard'
import { CloseIcon } from '../icons'
import { formatDate } from '../../utils'

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

- Returns null when not in active view
- Returns null when archived_at is in the past
- Returns null when archived_at is null
- Renders warning when archived_at is in the future
- Cancel button calls handler with stopPropagation

### Success Criteria
- Scheduled archive logic matches existing behavior exactly
- All tests pass

### Dependencies
- Milestone 1 (context for view)

---

## Milestone 5: Migrate NoteCard

### Goal
Refactor `NoteCard` to use `ContentCard` composition. NoteCard is chosen first because it's the simplest.

### Key Changes

**Modify: `frontend/src/components/NoteCard.tsx`**

Before: 246 lines with duplicated layout and action logic
After: ~120-140 lines composing ContentCard subcomponents

The header (icon, title, version badge, description) stays in NoteCard. The tags, actions, date display, and scheduled archive use ContentCard subcomponents.

### Testing Strategy

**Existing tests in `NoteCard.test.tsx` should pass unchanged.** This validates the refactor preserves behavior.

### Success Criteria
- All existing `NoteCard.test.tsx` tests pass without modification
- Visual appearance unchanged
- Line count reduced from 246 to ~120-140

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

Similar to NoteCard migration. PromptCard's header (icon, title/name display, description) stays in PromptCard.

### Testing Strategy

**Existing tests in `PromptCard.test.tsx` should pass unchanged.**

### Success Criteria
- All existing `PromptCard.test.tsx` tests pass
- Line count reduced from 253 to ~120-140

### Dependencies
- Milestone 5 (validates the pattern works)

---

## Milestone 7: Migrate BookmarkCard

### Goal
Refactor `BookmarkCard` to use `ContentCard` composition. This is the most complex card.

### Key Changes

**Modify: `frontend/src/components/BookmarkCard.tsx`**

BookmarkCard keeps all its entity-specific features in-component:
- `showContentTypeIcon` toggle logic
- Favicon rendering with error fallback
- URL display (inline on desktop, below title on mobile)
- Edit button with isLoading state
- Copy URL button with success feedback
- Link click tracking with silent mode (shift+cmd/ctrl)

Only the tags, actions container, date display, and scheduled archive use ContentCard subcomponents.

### Testing Strategy

**Existing tests in `BookmarkCard.test.tsx` should pass unchanged.**

Additional verification:
- `showContentTypeIcon` behavior preserved
- Edit button isLoading state works
- Copy URL feedback (success checkmark) works
- Favicon error fallback works

### Success Criteria
- All existing `BookmarkCard.test.tsx` tests pass
- All bookmark-specific features preserved
- Line count reduced from 379 to ~200-220

### Dependencies
- Milestone 6

### Risk Factors
- Most complex card, highest risk of regression
- Copy URL state management stays in BookmarkCard (not extracted)

---

## Milestone 8: Cleanup and Documentation

### Goal
Remove any dead code, ensure consistent patterns.

### Key Changes

1. Remove any unused imports from card components
2. Verify all barrel exports are correct
3. Run full test suite

### Testing Strategy

- `npm run lint` passes
- `npm run test:run` passes
- Manual visual review of all card types in all views

### Success Criteria
- No lint warnings
- All tests pass
- Clean code

### Dependencies
- Milestones 5-7

---

## Summary

| Milestone | Goal | Est. Lines Changed |
|-----------|------|-------------------|
| 1 | ContentCard container + context | +50 |
| 2 | Tags, DateDisplay subcomponents | +60 |
| 3 | Action subcomponents | +120 |
| 4 | ScheduledArchive subcomponent | +40 |
| 5 | Migrate NoteCard | -100 |
| 6 | Migrate PromptCard | -110 |
| 7 | Migrate BookmarkCard | -150 |
| 8 | Cleanup | +10 |

**Net result:** ~280 new lines for ContentCard, ~360 lines removed from card components = **~80 lines reduction** with significantly improved maintainability.

**The real wins:**
1. **Single source of truth** for actions, tags, date display, and scheduled archive
2. **Easy to add TaskCard** - compose the same subcomponents with task-specific header
3. **Reduced cognitive load** - each card file focuses on its unique behavior, not boilerplate
