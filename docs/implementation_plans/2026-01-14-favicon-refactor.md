# Favicon Refactor Implementation Plan

## Overview

Refactor favicon handling to move logic from frontend to backend. Currently, the frontend fetches favicons from DuckDuckGo at render time, but cannot detect placeholder images due to CORS restrictions. The new approach fetches and stores the actual favicon image data in the database when bookmarks are created, eliminating all external requests from the frontend.

## Goals

1. Store actual favicon image data (base64) in the bookmark database record
2. Backend fetches and validates favicon during bookmark creation
3. Handle Google Docs/Sheets/Slides/Gmail special cases in the backend
4. Frontend simply displays the favicon data if present - no external requests
5. Remove all frontend favicon fetching/detection code

## Key Technical Decisions

- **Store image data, not URL**: The `favicon` column stores base64-encoded image data (e.g., `data:image/png;base64,...`), not a URL. This means:
  - Frontend makes zero external requests for favicons
  - Works offline once loaded
  - Not dependent on external services at render time

- **Google Favicon API**: `https://www.google.com/s2/favicons?domain={domain}&sz=32`
  - Returns HTTP 404 for unknown domains (detectable server-side)
  - Backend downloads the actual image bytes when status is 200
  - No CORS restrictions when called from backend

- **Google Service Special Cases**: Backend downloads these specific icons:
  - `docs.google.com/document/*` → Google Docs icon
  - `docs.google.com/spreadsheets/*` → Google Sheets icon
  - `docs.google.com/presentation/*` → Google Slides icon
  - `mail.google.com/*` → Gmail icon

- **Favicon fetched during bookmark creation**: NOT during `/fetch-metadata`. The favicon is fetched and stored when the bookmark is actually saved (POST /bookmarks/).

- **Inline async fetch (not background)**: The favicon is fetched inline during the save request using async I/O. This adds ~100-500ms latency but ensures:
  - Favicon is included in the save response for immediate display
  - No need for polling, websockets, or a second request
  - Simpler architecture (no task queue needed)

- **Timeout**: 3 seconds. If it doesn't respond by then, it won't.

- **Favicon size**: Request 32x32 from Google API (`sz=32`). Crisp on retina displays when shown at 16x16 CSS pixels.

---

## Milestone 1: Database Migration & Model Update

**Goal**: Add `favicon` column to bookmarks table for storing base64 image data

**Dependencies**: None

**Key Changes**:

1. Create Alembic migration to add `favicon` column:
   ```python
   # In migration file
   op.add_column('bookmarks', sa.Column('favicon', sa.Text(), nullable=True))
   ```

2. Update `Bookmark` model in `backend/src/models/bookmark.py`:
   ```python
   favicon: Mapped[str | None] = mapped_column(Text, nullable=True)
   ```

3. Update schemas in `backend/src/schemas/bookmark.py`:
   - Add `favicon: str | None = None` to `BookmarkResponse`
   - Add `favicon: str | None = None` to `BookmarkListItem`
   - Do NOT add to `BookmarkCreate` or `BookmarkUpdate` - favicon is set by backend, not client

**Testing Strategy**:
- Verify migration runs successfully (up and down)
- Verify model accepts favicon field
- Verify API responses include favicon field

**Success Criteria**:
- Migration applies cleanly
- Existing bookmarks have `favicon = NULL`
- API responses include favicon field

**Risk Factors**:
- Text column for base64 data - favicons are small (~1-10KB base64), so this is fine

---

## Milestone 2: Backend Favicon Service

**Goal**: Create service to fetch favicon image data for a URL

**Dependencies**: Milestone 1 (database schema)

**Key Changes**:

1. Create favicon service in `backend/src/services/favicon.py`:
   ```python
   import httpx
   import base64
   from urllib.parse import urlparse

   # Google service favicon URLs (we'll download these)
   GOOGLE_SERVICE_FAVICON_URLS = {
       'docs': 'https://www.gstatic.com/images/branding/product/1x/docs_2020q4_48dp.png',
       'sheets': 'https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_48dp.png',
       'slides': 'https://www.gstatic.com/images/branding/product/1x/slides_2020q4_48dp.png',
       'gmail': 'https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_48dp.png',
   }

   async def get_favicon(url: str, timeout: float = 3.0) -> str | None:
       """
       Fetch favicon for a URL and return as base64 data URL.
       Returns None if no valid favicon exists (404 or error).

       Args:
           url: The bookmark URL to get favicon for
           timeout: Request timeout in seconds

       Returns:
           Base64 data URL (e.g., "data:image/png;base64,...") or None
       """
       favicon_url = _get_favicon_url(url)

       try:
           async with httpx.AsyncClient(timeout=timeout) as client:
               response = await client.get(favicon_url, follow_redirects=True)
               if response.status_code != 200:
                   return None

               # Get content type for data URL
               content_type = response.headers.get('content-type', 'image/png')
               # Handle content-type with charset (e.g., "image/png; charset=utf-8")
               content_type = content_type.split(';')[0].strip()

               # Encode as base64 data URL
               b64_data = base64.b64encode(response.content).decode('utf-8')
               return f"data:{content_type};base64,{b64_data}"
       except (httpx.RequestError, httpx.TimeoutException):
           return None

   def _get_favicon_url(url: str) -> str:
       """Get the favicon URL to fetch for a given bookmark URL."""
       # Check Google service special cases first
       if 'docs.google.com/document' in url:
           return GOOGLE_SERVICE_FAVICON_URLS['docs']
       if 'docs.google.com/spreadsheets' in url:
           return GOOGLE_SERVICE_FAVICON_URLS['sheets']
       if 'docs.google.com/presentation' in url:
           return GOOGLE_SERVICE_FAVICON_URLS['slides']

       domain = urlparse(url).netloc
       if domain == 'mail.google.com':
           return GOOGLE_SERVICE_FAVICON_URLS['gmail']

       # Default: Google's favicon API
       return f'https://www.google.com/s2/favicons?domain={domain}&sz=32'
   ```

**Testing Strategy**:
- Unit tests for `_get_favicon_url()`:
  - Test Google Docs URL returns docs favicon URL
  - Test Google Sheets URL returns sheets favicon URL
  - Test Google Slides URL returns slides favicon URL
  - Test Gmail URL returns gmail favicon URL
  - Test regular domain returns Google favicon API URL
- Unit tests for `get_favicon()` (mock httpx):
  - Test successful fetch returns base64 data URL
  - Test 404 response returns None
  - Test timeout returns None
  - Test network error returns None
- Integration test (network):
  - Test Google service favicon URLs still return 200
  - Test known valid domain returns favicon data
  - Test invalid domain returns None

**Success Criteria**:
- Service fetches and encodes favicons correctly
- Returns None for invalid/unknown domains
- Handles timeouts and errors gracefully

**Risk Factors**:
- Google favicon API could change behavior

---

## Milestone 3: Integrate Favicon Fetching into Bookmark Creation

**Goal**: Automatically fetch and store favicon when bookmarks are created or URL is updated

**Dependencies**: Milestone 2 (favicon service)

**Key Changes**:

1. Update `BookmarkService.create()` in `backend/src/services/bookmark_service.py`:
   ```python
   from .favicon import get_favicon

   async def create(self, db: AsyncSession, user_id: UUID, data: BookmarkCreate) -> Bookmark:
       # ... existing validation and creation logic ...

       bookmark = Bookmark(
           user_id=user_id,
           url=url_str,
           title=data.title,
           description=data.description,
           content=data.content,
           archived_at=data.archived_at,
       )

       # Fetch favicon (non-blocking, don't fail creation if this fails)
       bookmark.favicon = await get_favicon(url_str)

       # ... rest of existing logic ...
   ```

2. Update `BookmarkService.update()` to re-fetch favicon if URL changes:
   ```python
   async def update(self, db: AsyncSession, user_id: UUID, bookmark_id: UUID, data: BookmarkUpdate) -> Bookmark:
       # ... existing logic ...

       # If URL changed, re-fetch favicon
       if data.url is not None and str(data.url) != bookmark.url:
           bookmark.favicon = await get_favicon(str(data.url))

       # ... rest of existing logic ...
   ```

**Testing Strategy**:
- Test bookmark creation fetches and stores favicon
- Test bookmark creation succeeds even if favicon fetch fails (timeout, error)
- Test bookmark update re-fetches favicon when URL changes
- Test bookmark update keeps existing favicon when URL unchanged

**Success Criteria**:
- New bookmarks have favicon populated automatically
- Bookmark creation doesn't fail if favicon fetch fails
- URL changes trigger favicon re-fetch

**Risk Factors**:
- Favicon fetch adds ~100-500ms latency to bookmark creation (acceptable tradeoff for immediate display)

---

## Milestone 4: Frontend Simplification

**Goal**: Remove all frontend favicon logic, display favicon from API response

**Dependencies**: Milestone 3 (backend stores favicon)

**Key Changes**:

1. Update frontend types in `frontend/src/types/index.ts`:
   - Add `favicon: string | null` to `BookmarkListItem` type

2. Simplify `BookmarkCard.tsx`:
   - Remove all favicon fetching/caching logic
   - Remove imports: `getFaviconUrl`, `faviconCache`, `isDuckDuckGoPlaceholder`
   - Simply display `bookmark.favicon` if present:
   ```tsx
   {/* Favicon between title and URL */}
   {bookmark.favicon && (
     <img
       src={bookmark.favicon}
       alt=""
       className="w-4 h-4 shrink-0"
     />
   )}
   ```

3. Delete `frontend/src/utils/favicon.ts` (no longer needed)

4. Remove favicon-related tests from `BookmarkCard.test.tsx`:
   - Remove `getFaviconUrl` tests
   - Remove `GOOGLE_FAVICON_URLS` tests
   - Remove DuckDuckGo placeholder tests
   - Add simple test: displays favicon when present, doesn't when null

**Testing Strategy**:
- Test BookmarkCard displays favicon image when `bookmark.favicon` is present
- Test BookmarkCard doesn't render favicon img when `bookmark.favicon` is null
- Verify no external favicon requests are made

**Success Criteria**:
- BookmarkCard displays favicons from API data
- No client-side favicon fetching code remains
- All favicon logic is in backend

**Risk Factors**:
- Ensure all bookmark list/display components are updated
- May need to update other components that show bookmarks

---

## Milestone 5: Backfill Existing Bookmarks

**Goal**: Populate favicon for existing bookmarks that have `favicon = NULL`

**Dependencies**: Milestones 1-4 complete

**Key Changes**:

1. Create management script `backend/scripts/backfill_favicons.py`:
   ```python
   """
   One-time script to populate favicon for existing bookmarks.

   Usage:
       cd backend
       uv run python scripts/backfill_favicons.py
   """
   import asyncio
   from sqlalchemy import select
   from src.db.session import get_async_session
   from src.models import Bookmark
   from src.services.favicon import get_favicon

   async def backfill_favicons(batch_size: int = 100, delay: float = 0.1):
       """Backfill favicons for bookmarks that don't have one."""
       async with get_async_session() as db:
           result = await db.execute(
               select(Bookmark).where(Bookmark.favicon.is_(None))
           )
           bookmarks = result.scalars().all()

           print(f"Found {len(bookmarks)} bookmarks without favicon")

           for i, bookmark in enumerate(bookmarks):
               try:
                   favicon = await get_favicon(bookmark.url)
                   bookmark.favicon = favicon

                   # Commit in batches
                   if (i + 1) % batch_size == 0:
                       await db.commit()
                       print(f"Processed {i + 1}/{len(bookmarks)}")

                   # Small delay to avoid rate limiting
                   await asyncio.sleep(delay)
               except Exception as e:
                   print(f"Error processing bookmark {bookmark.id}: {e}")
                   continue

           # Final commit
           await db.commit()
           print(f"Done! Processed {len(bookmarks)} bookmarks")

   if __name__ == "__main__":
       asyncio.run(backfill_favicons())
   ```

**Testing Strategy**:
- Test script handles errors gracefully (continues on failure)
- Test script commits in batches
- Test script is idempotent (can run multiple times safely)

**Success Criteria**:
- Existing bookmarks have favicon populated
- Script can be run safely multiple times
- Errors are logged but don't stop the script

**Risk Factors**:
- Could be slow for large datasets (mitigated by batching and delays)
- Google may rate limit (mitigated by delay between requests)

---

## Files to Modify

### Backend
- `backend/src/models/bookmark.py` - Add `favicon` field
- `backend/src/schemas/bookmark.py` - Add `favicon` to response schemas
- `backend/src/services/favicon.py` - NEW: Favicon fetching service
- `backend/src/services/bookmark_service.py` - Call favicon service on create/update
- `backend/alembic/versions/` - NEW: Migration file
- `backend/tests/services/test_favicon.py` - NEW: Favicon service tests
- `backend/tests/` - Update bookmark service tests
- `backend/scripts/backfill_favicons.py` - NEW: Backfill script

### Frontend
- `frontend/src/types/index.ts` - Add `favicon` to BookmarkListItem type
- `frontend/src/components/BookmarkCard.tsx` - Simplify to use API data
- `frontend/src/utils/favicon.ts` - DELETE
- `frontend/src/components/BookmarkCard.test.tsx` - Remove favicon fetching tests

---

## Reference URLs

- Google Favicon API: `https://www.google.com/s2/favicons?domain={domain}&sz={size}`
- Google Docs icon: `https://www.gstatic.com/images/branding/product/1x/docs_2020q4_48dp.png`
- Google Sheets icon: `https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_48dp.png`
- Google Slides icon: `https://www.gstatic.com/images/branding/product/1x/slides_2020q4_48dp.png`
- Gmail icon: `https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_48dp.png`
