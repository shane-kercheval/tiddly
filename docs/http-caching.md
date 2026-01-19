# HTTP Caching

The API supports HTTP caching via `ETag` and `Last-Modified` headers. Clients can use these to avoid re-downloading unchanged data, reducing bandwidth and improving perceived performance.

## Quick Start

```bash
# First request - no caching headers
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/bookmarks/123

# Response includes:
# ETag: W/"a1b2c3d4e5f67890"
# Last-Modified: Wed, 15 Jan 2026 10:30:00 GMT

# Subsequent request - use cached ETag
curl -H "Authorization: Bearer $TOKEN" \
     -H "If-None-Match: W/\"a1b2c3d4e5f67890\"" \
     https://api.example.com/bookmarks/123

# If unchanged: 304 Not Modified (empty body, use cached data)
# If changed: 200 OK with new data and new ETag
```

## Two Caching Mechanisms

### ETag (All GET JSON Endpoints)

Every successful GET request returning JSON includes an `ETag` header—a content hash of the response body.

**How to use:**
1. Store the `ETag` value from the response
2. On subsequent requests, send `If-None-Match: <etag>`
3. If content unchanged, server returns `304 Not Modified` (no body)
4. If content changed, server returns `200 OK` with new data and new `ETag`

**Applies to:** All GET endpoints returning JSON (list endpoints, single resources, etc.)

**What it saves:** Bandwidth only. The server still executes the full query to compute the hash.

### Last-Modified (Single-Resource Endpoints)

Single-resource endpoints also include a `Last-Modified` header with the resource's `updated_at` timestamp.

**How to use:**
1. Store the `Last-Modified` value from the response
2. On subsequent requests, send `If-Modified-Since: <date>`
3. If resource unchanged, server returns `304 Not Modified`
4. If resource changed, server returns `200 OK` with new data

**Applies to:**
- `GET /bookmarks/{id}`
- `GET /notes/{id}`
- `GET /prompts/{id}`
- `GET /prompts/name/{name}`

**What it saves:** Bandwidth AND server work. The server runs a lightweight timestamp check before fetching the full resource.

## Header Precedence

If you send both `If-None-Match` and `If-Modified-Since`, the server uses `If-None-Match` only (per HTTP spec). Use one or the other:

- **Prefer `If-None-Match`** for list endpoints or when you need byte-accurate change detection
- **Prefer `If-Modified-Since`** for single resources when you want to minimize server load

## Response Headers

All cacheable responses include:

| Header | Value | Purpose |
|--------|-------|---------|
| `ETag` | `W/"..."` | Content hash for conditional requests |
| `Last-Modified` | RFC 7231 date | Resource timestamp (single-resource endpoints only) |
| `Cache-Control` | `private, must-revalidate` | User-specific data, always revalidate with server |
| `Vary` | `Authorization` | Response varies by auth token |

## Client Implementation Example

```typescript
// Pseudocode for a caching HTTP client

interface CacheEntry {
  etag?: string;
  lastModified?: string;
  data: any;
}

const cache = new Map<string, CacheEntry>();

async function fetchWithCache(url: string, token: string): Promise<any> {
  const cached = cache.get(url);
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
  };

  // Add conditional headers if we have cached data
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  } else if (cached?.lastModified) {
    headers['If-Modified-Since'] = cached.lastModified;
  }

  const response = await fetch(url, { headers });

  if (response.status === 304) {
    // Not modified - return cached data
    return cached!.data;
  }

  // New data - update cache
  const data = await response.json();
  cache.set(url, {
    etag: response.headers.get('ETag') ?? undefined,
    lastModified: response.headers.get('Last-Modified') ?? undefined,
    data,
  });

  return data;
}
```

## Multiple ETags

The `If-None-Match` header supports multiple ETags (comma-separated) and wildcards:

```bash
# Multiple ETags (useful if client has multiple cached versions)
If-None-Match: W/"abc123", W/"def456"

# Wildcard (matches any ETag - useful for "only if resource exists")
If-None-Match: *
```

## Status Codes

| Code | Meaning |
|------|---------|
| `200 OK` | Resource changed or no conditional headers sent |
| `304 Not Modified` | Resource unchanged, use cached version |
| `404 Not Found` | Resource doesn't exist |

## Notes

- ETags are "weak" (`W/` prefix), indicating semantic equivalence rather than byte-for-byte identity
- `Last-Modified` has second precision (microseconds truncated)
- Cache headers are only added to successful responses (status < 400)
- Non-GET requests (POST, PATCH, DELETE) don't participate in caching
