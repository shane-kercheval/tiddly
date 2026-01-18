# HTTP Caching Implementation

## Overview

Implement HTTP caching to reduce bandwidth and improve mobile app performance. Two complementary strategies:

1. **ETag Middleware** - Automatically hash JSON responses and return 304 Not Modified when client has current version
2. **Manual Last-Modified** - For single-resource endpoints, skip the full DB query (large content fields, tag joins) when resource unchanged

**Problem:** Mobile app makes full API requests even when data hasn't changed, wasting bandwidth and battery.

**Solution:** HTTP caching headers allow the server to return tiny 304 responses instead of full payloads when nothing has changed.

**Documentation:** Read before implementing:
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Last-Modified
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-Modified-Since
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/304
- https://fastapi.tiangolo.com/advanced/middleware/

---

## Background: How HTTP Caching Works

### ETag Flow
```
1. Client: GET /bookmarks/
2. Server: 200 OK, ETag: "abc123", body: [...]
3. Client caches response with ETag

Later:
4. Client: GET /bookmarks/, If-None-Match: "abc123"
5. Server: Builds response, hashes it, compares to "abc123"
6a. If match: 304 Not Modified (empty body) - saves bandwidth
6b. If different: 200 OK, ETag: "xyz789", body: [...]
```

**Trade-off:** Server still does full DB query and JSON serialization to compute hash, but saves bandwidth on unchanged responses.

### Last-Modified Flow (for single resources)
```
1. Client: GET /bookmarks/{id}
2. Server: 200 OK, Last-Modified: Wed, 15 Jan 2026 10:30:00 GMT, body: {...}
3. Client caches response with timestamp

Later:
4. Client: GET /bookmarks/{id}, If-Modified-Since: Wed, 15 Jan 2026 10:30:00 GMT
5. Server: Quick query - SELECT updated_at WHERE id = ? AND user_id = ?
6a. If updated_at <= If-Modified-Since: 304 Not Modified - skips full query AND saves bandwidth
6b. If updated_at > If-Modified-Since: Full query, 200 OK with new data
```

**Trade-off:** Requires extra code per endpoint, but can skip the expensive full query (we still do a lightweight `SELECT updated_at` check).

---

## Design Decisions

### 1. Which Endpoints Get Which Strategy

**ETag Middleware (global):** Applies automatically to ALL GET requests returning JSON. No exclusions needed - the middleware naturally skips:
- Non-GET requests (POST, PATCH, DELETE)
- Non-JSON responses
- Error responses (4xx, 5xx)

**Last-Modified (targeted):** Added manually to single-resource endpoints where we can skip the full DB query:

| Endpoint | Strategy | Rationale |
|----------|----------|-----------|
| `GET /bookmarks/{id}` | ETag + Last-Modified | Single resource with `updated_at` - can skip DB query |
| `GET /notes/{id}` | ETag + Last-Modified | Same as single bookmark |
| `GET /prompts/{id}` | ETag + Last-Modified | Same as single bookmark |
| `GET /prompts/name/{name}` | ETag + Last-Modified | MCP uses this frequently |

List endpoints (`/bookmarks/`, `/notes/`, etc.) only get ETag - checking "has anything in this filtered/sorted list changed?" would require querying all items anyway.

### 2. ETag Generation

Use weak ETags (prefixed with `W/`) since our responses are semantically equivalent even if bytes differ slightly:

```python
import hashlib

def generate_etag(content: bytes) -> str:
    """Generate weak ETag from response content."""
    hash_value = hashlib.md5(content).hexdigest()[:16]
    return f'W/"{hash_value}"'
```

**Why MD5?** Speed over security - we're not using this for cryptographic purposes, just content fingerprinting. MD5 is faster than SHA-256 and sufficient for cache validation.

**Why weak ETag?** Strong ETags (`"abc"`) mean byte-for-byte identical. Weak ETags (`W/"abc"`) mean semantically equivalent. JSON serialization might vary slightly (key ordering, whitespace) but represent the same data.

### 3. Middleware vs Decorator

**Decision: Middleware for ETag, Decorator for Last-Modified**

- ETag middleware applies globally to all GET requests returning JSON - simple, consistent
- Last-Modified requires endpoint-specific logic (different tables, different `updated_at` fields) - decorator pattern

### 4. Header Precedence

When both `If-None-Match` (ETag) and `If-Modified-Since` are present, `If-None-Match` takes precedence per HTTP spec. Our Last-Modified decorator should check for ETag header first and skip if present (let middleware handle it).

### 5. Cache-Control and Vary Headers

Add these headers to all cacheable responses:
- `Cache-Control: private, must-revalidate`
  - `private` - Response is user-specific, don't cache in shared caches (CDNs)
  - `must-revalidate` - Client must validate with server before using cached response
  - No `max-age` - we want clients to always revalidate (send If-None-Match/If-Modified-Since)
- `Vary: Authorization` - Tells caches the response varies by auth header, preventing cross-user cache pollution

### 6. 304 Response Headers

Per HTTP spec, 304 responses must include headers that would affect caching of the stored response. Our 304 responses must include:
- `ETag` (if validating via If-None-Match)
- `Last-Modified` (if validating via If-Modified-Since)
- `Cache-Control: private, must-revalidate`
- `Vary: Authorization`

Security headers (HSTS, X-Frame-Options, etc.) are added by `SecurityHeadersMiddleware` which runs after `ETagMiddleware`, so they're automatically included on 304 responses.

---

## Milestone 1: ETag Middleware

### Goal
Create middleware that automatically adds ETag headers to GET JSON responses and returns 304 when client has current version.

### Success Criteria
- All GET endpoints returning JSON include `ETag` and `Cache-Control` headers
- Requests with matching `If-None-Match` header receive 304 response
- Non-GET requests are unaffected
- Non-JSON responses are unaffected
- Existing functionality unchanged

### Key Changes

1. **Create `backend/src/core/http_cache.py`** with:
   - `ETagMiddleware` class extending `BaseHTTPMiddleware`
   - `generate_etag(content: bytes) -> str` function
   - Middleware logic:
     ```python
     CACHE_HEADERS = {
         "Cache-Control": "private, must-revalidate",
         "Vary": "Authorization",
     }

     async def dispatch(self, request: Request, call_next) -> Response:
         # Skip non-GET requests
         if request.method != "GET":
             return await call_next(request)

         response = await call_next(request)

         # Skip non-JSON or error responses
         content_type = response.headers.get("content-type", "")
         if "application/json" not in content_type or response.status_code >= 400:
             return response

         # Read response body, generate ETag
         body = b"".join([chunk async for chunk in response.body_iterator])
         etag = generate_etag(body)

         # Check If-None-Match
         if_none_match = request.headers.get("if-none-match")
         if if_none_match and if_none_match == etag:
             # 304 must include caching headers per HTTP spec
             return Response(status_code=304, headers={"ETag": etag, **CACHE_HEADERS})

         # Return response with caching headers
         return Response(
             content=body,
             status_code=response.status_code,
             headers={**response.headers, "ETag": etag, **CACHE_HEADERS},
             media_type=response.media_type,
         )
     ```

2. **Update `backend/src/api/main.py`**:
   - Import and add `ETagMiddleware`
   - Add BEFORE `SecurityHeadersMiddleware` (so security headers are added to 304 responses too)

### Testing Strategy

Create `backend/tests/api/test_http_cache.py`:

1. **Test ETag generation:**
   - Same content produces same ETag
   - Different content produces different ETag
   - ETag format is correct (`W/"..."`)

2. **Test middleware behavior:**
   - GET request without `If-None-Match` receives ETag header
   - GET request with matching `If-None-Match` receives 304
   - GET request with non-matching `If-None-Match` receives 200 with new ETag
   - POST/PATCH/DELETE requests don't get ETag headers
   - Error responses (4xx, 5xx) don't get ETag headers
   - Non-JSON responses don't get ETag headers

3. **Test caching headers:**
   - Verify `Cache-Control: private, must-revalidate` is present on 200 responses
   - Verify `Cache-Control: private, must-revalidate` is present on 304 responses
   - Verify `Vary: Authorization` is present on both 200 and 304 responses

4. **Integration test with real endpoint:**
   - Create bookmark, GET it, note ETag
   - GET again with `If-None-Match: <etag>`, verify 304
   - Update bookmark, GET with old ETag, verify 200 with new ETag

### Dependencies
None

### Risk Factors
- **Response body consumption:** Middleware needs to read the response body to hash it, then create a new response. Ensure this doesn't break streaming responses (we don't have any, but worth noting).
- **Header copying:** When creating new Response, ensure all original headers are preserved (rate limit headers, CORS headers, etc.)

---

## Milestone 2: Last-Modified for Single Resource Endpoints

### Goal
Add Last-Modified support to single-resource GET endpoints (`/bookmarks/{id}`, `/notes/{id}`, `/prompts/{id}`, `/prompts/name/{name}`) to skip the full database query when resource unchanged.

### Success Criteria
- Single-resource endpoints include `Last-Modified` header
- Requests with `If-Modified-Since` >= `updated_at` receive 304 (when no `If-None-Match` present)
- Requests with `If-Modified-Since` < `updated_at` receive full response
- When `If-None-Match` is present, defer to ETag middleware (skip Last-Modified check)
- Full database query is skipped when returning 304 (only lightweight `SELECT updated_at` runs)
- OpenAPI schema remains intact (200 responses still show correct response model)

### Key Changes

1. **Add to `backend/src/core/http_cache.py`**:
   - `format_http_date(dt: datetime) -> str` - Format datetime as HTTP date
   - `parse_http_date(date_str: str) -> datetime | None` - Parse HTTP date header
   - `check_not_modified(request: Request, updated_at: datetime) -> Response | None` helper:
     ```python
     def check_not_modified(request: Request, updated_at: datetime) -> Response | None:
         """
         Check If-Modified-Since header and return 304 response if not modified.
         Returns None if request should proceed with full response.
         Skips check if If-None-Match is present (ETag takes precedence).
         """
         # ETag takes precedence - let middleware handle it
         if request.headers.get("if-none-match"):
             return None

         if_modified_since = request.headers.get("if-modified-since")
         if not if_modified_since:
             return None

         client_date = parse_http_date(if_modified_since)
         if client_date is None:
             return None

         # Compare timestamps (truncate to seconds for HTTP date precision)
         if updated_at.replace(microsecond=0) <= client_date:
             # 304 must include caching headers per HTTP spec
             return Response(
                 status_code=304,
                 headers={
                     "Last-Modified": format_http_date(updated_at),
                     "Cache-Control": "private, must-revalidate",
                     "Vary": "Authorization",
                 },
             )

         return None
     ```

2. **Add service methods to check updated_at without full fetch**:

   In `backend/src/services/base_entity_service.py`, add:
   ```python
   async def get_updated_at(
       self, db: AsyncSession, user_id: UUID, entity_id: UUID
   ) -> datetime | None:
       """Get just the updated_at timestamp for cache validation. Returns None if not found."""
       stmt = select(self.model.updated_at).where(
           self.model.id == entity_id,
           self.model.user_id == user_id,
       )
       result = await db.execute(stmt)
       return result.scalar_one_or_none()
   ```

   In `backend/src/services/prompt_service.py`, add (for name-based lookup):
   ```python
   async def get_updated_at_by_name(
       self, db: AsyncSession, user_id: UUID, name: str
   ) -> datetime | None:
       """Get updated_at timestamp by prompt name for cache validation."""
       stmt = select(Prompt.updated_at).where(
           Prompt.name == name,
           Prompt.user_id == user_id,
           Prompt.deleted_at.is_(None),
       )
       result = await db.execute(stmt)
       return result.scalar_one_or_none()
   ```

3. **Update single-resource endpoints** (example for bookmarks):

   In `backend/src/api/routers/bookmarks.py`:
   ```python
   from fastapi import Response as FastAPIResponse
   from core.http_cache import check_not_modified, format_http_date

   @router.get("/{bookmark_id}", response_model=BookmarkResponse)
   async def get_bookmark(
       bookmark_id: UUID,
       request: Request,  # For reading If-Modified-Since header
       response: FastAPIResponse,  # FastAPI injects this, lets us set headers on 200
       current_user: User = Depends(get_current_user),
       db: AsyncSession = Depends(get_async_session),
   ) -> BookmarkResponse:
       """Get a single bookmark by ID."""
       # Quick check: can we return 304?
       updated_at = await bookmark_service.get_updated_at(db, current_user.id, bookmark_id)
       if updated_at is None:
           raise HTTPException(status_code=404, detail="Bookmark not found")

       not_modified = check_not_modified(request, updated_at)
       if not_modified:
           return not_modified  # 304 response - bypasses response_model

       # Full fetch
       bookmark = await bookmark_service.get(
           db, current_user.id, bookmark_id, include_archived=True, include_deleted=True,
       )
       if bookmark is None:
           raise HTTPException(status_code=404, detail="Bookmark not found")

       # Set Last-Modified header on the injected response object
       # This preserves the OpenAPI schema (returning Pydantic model, not Response)
       response.headers["Last-Modified"] = format_http_date(updated_at)
       return BookmarkResponse.model_validate(bookmark)
   ```

   **Note on OpenAPI schema:** By returning the Pydantic model for 200 responses and using the injected `response` parameter to set headers, the OpenAPI schema remains correct. The 304 response bypasses the `response_model` validation, which is allowed by FastAPI.

4. **Apply same pattern to:**
   - `GET /notes/{note_id}` in `notes.py`
   - `GET /prompts/{prompt_id}` in `prompts.py`
   - `GET /prompts/name/{name}` in `prompts.py` (use `get_updated_at_by_name` instead of `get_updated_at`)

### Testing Strategy

Add tests to `backend/tests/api/test_http_cache.py`:

1. **Test HTTP date formatting/parsing:**
   - Round-trip test: format then parse returns equivalent datetime
   - Invalid date strings return None
   - Various valid HTTP date formats parse correctly

2. **Test `check_not_modified` helper:**
   - Returns None when no `If-Modified-Since` header
   - Returns None when `If-None-Match` header present (ETag precedence)
   - Returns 304 when `If-Modified-Since` >= `updated_at`
   - Returns None when `If-Modified-Since` < `updated_at`
   - 304 response includes `Cache-Control` and `Vary: Authorization` headers

3. **Test `get_updated_at` service method:**
   - Returns timestamp for existing entity
   - Returns None for non-existent entity
   - Respects user_id (can't see other user's timestamps)

4. **Test `get_updated_at_by_name` (PromptService):**
   - Returns timestamp for existing prompt by name
   - Returns None for non-existent name
   - Returns None for deleted prompts (respects soft delete)
   - Respects user_id (can't see other user's timestamps)

5. **Integration tests per endpoint:**
   - `GET /bookmarks/{id}`:
     - Without headers: returns 200 with Last-Modified and ETag
     - With old `If-Modified-Since`: returns 200 (data changed)
     - With current `If-Modified-Since`: returns 304
     - With `If-None-Match` (matching): returns 304 (ETag precedence)
   - Same tests for `/notes/{id}`, `/prompts/{id}`, `/prompts/name/{name}`

6. **Test 404 handling:**
   - Non-existent resource with `If-Modified-Since` returns 404, not 304

### Dependencies
Milestone 1 (ETag middleware must be in place)

### Risk Factors
- **Timestamp precision:** HTTP dates have second precision; `updated_at` has microsecond precision. Truncate appropriately when comparing.
- **Timezone handling:** Ensure `updated_at` (stored with timezone) converts correctly to HTTP date (always GMT).

---

## Milestone 3: Testing and Documentation

### Goal
Ensure comprehensive test coverage and update API documentation.

### Success Criteria
- All tests pass
- Manual testing confirms expected behavior
- CLAUDE.md updated with HTTP caching documentation

### Key Changes

1. **Add comprehensive edge case tests:**
   - Multiple `If-None-Match` values (comma-separated)
   - `If-None-Match: *` (matches any ETag)
   - Malformed headers (graceful handling)
   - Large responses (ensure ETag still works)
   - Concurrent requests (no race conditions in middleware)

2. **Manual testing checklist:**
   - Use `curl -v` to verify headers on various endpoints
   - Test with real mobile app (if available) to confirm bandwidth savings
   - Verify DevTools Network tab shows 304 responses

3. **Update `CLAUDE.md`** with new section:
   ```markdown
   ### HTTP Caching

   The API supports HTTP caching via ETag and Last-Modified headers:

   **ETag (all GET JSON endpoints):**
   - Server includes `ETag` header with response hash
   - Client sends `If-None-Match: <etag>` on subsequent requests
   - Server returns 304 Not Modified if content unchanged (saves bandwidth, not DB work)

   **Last-Modified (single-resource endpoints):**
   - `/bookmarks/{id}`, `/notes/{id}`, `/prompts/{id}`, `/prompts/name/{name}`
   - Server includes `Last-Modified` header with `updated_at` timestamp
   - Client sends `If-Modified-Since: <date>` on subsequent requests
   - Server can skip the full database query if resource unchanged (only runs lightweight `SELECT updated_at`)

   **Header Precedence:** `If-None-Match` takes precedence over `If-Modified-Since`

   **Caching Headers:** All cacheable responses include:
   - `Cache-Control: private, must-revalidate` - User-specific data, always revalidate
   - `Vary: Authorization` - Response varies by auth header
   ```

### Testing Strategy
- Run full test suite
- Manual curl testing for each endpoint type
- Verify CLAUDE.md renders correctly

### Dependencies
Milestones 1 and 2

### Risk Factors
- None significant at this stage

---

## Summary of Files Changed

### New Files
- `backend/src/core/http_cache.py` - ETag middleware, Last-Modified helpers
- `backend/tests/api/test_http_cache.py` - HTTP caching tests

### Modified Files
- `backend/src/api/main.py` - Add ETagMiddleware
- `backend/src/services/base_entity_service.py` - Add `get_updated_at` method
- `backend/src/services/prompt_service.py` - Add `get_updated_at_by_name` method
- `backend/src/api/routers/bookmarks.py` - Add Last-Modified to `get_bookmark`
- `backend/src/api/routers/notes.py` - Add Last-Modified to `get_note`
- `backend/src/api/routers/prompts.py` - Add Last-Modified to `get_prompt` and `get_prompt_by_name`
- `CLAUDE.md` - Document HTTP caching

---

## Frontend Considerations

The frontend's TanStack Query setup should automatically benefit from HTTP caching without code changes, as long as the fetch calls don't override browser caching behavior. Verify that `services/api.ts` (or equivalent) doesn't set `cache: 'no-store'` or similar options that would bypass HTTP caching.

If using custom fetch wrappers, ensure they pass through cache-related headers (`If-None-Match`, `If-Modified-Since`) and respect 304 responses. Most browsers handle this automatically for standard `fetch()` calls.
