# Public View: Shareable Read-Only URLs for Bookmarks, Notes, and Prompts

**Date:** 2026-06-17
**Status:** Draft (reviewed)

## Summary

Allow users to publish individual bookmarks, notes, and prompts to a stable public URL, accessible by anyone without authentication. The public view is read-only, showing content and metadata but not the owner's organizational data (tags, relationships). Authenticated visitors can save a copy to their own account. The owner can unpublish at any time, or rotate the share token to invalidate the previous URL.

## What the feature does, end to end

A user can take any one of their bookmarks, notes, or prompts and **publish it to a stable public URL** that anyone can open without logging in. The public page is **read-only**: it shows the content and a few factual properties (title, description, body, created/updated dates, and an "archived" indicator if relevant), but it deliberately **hides the owner's organizational layer** — tags, relationships, and any owner-identity fields never appear publicly.

A visitor who *is* logged in sees one action: **"Save a copy,"** which clones the item into their own account as a fresh, independent item. A visitor who *isn't* logged in sees a sign-in prompt instead.

The owner stays in control of access through three operations: **publish, unpublish, and rotate.** Unpublishing immediately makes the URL stop working but keeps the token, so re-publishing restores the *same* URL. Rotating throws away the current token and issues a new one, permanently breaking the old link. Because public responses are set to revalidate on every request, revocation takes effect **immediately** — there's no window where a stale cached copy keeps serving revoked content.

**How the public identity works:** the public URL is keyed on a separate random **`public_token`**, not the item's internal UUID. The token is generated from `secrets.token_urlsafe(32)` (256 bits of entropy — unguessable) and stored **as plaintext** in the item's row (unlike API tokens, which are hashed). Lookups are a plain equality match on that token. This means the public surface never exposes internal IDs, and access can be revoked by changing one column without touching the item itself.

**One important design choice:** sharing is *not* treated as an edit. Publishing, unpublishing, and rotating go through **dedicated endpoints** that write only the sharing columns — they don't bump the item's "last updated" time and don't create a history entry. So sharing an item never makes it look freshly edited.

---

## Milestone-by-milestone functional outcomes

### M1 — Database foundation
**Tables changed:** the three existing content tables — `bookmarks`, `notes`, `prompts`. No new tables.

**Fields added to each:**
- `is_public` — boolean, defaults to `false`, never null. The on/off switch.
- `public_token` — nullable text (max 64 chars). Holds the random token when published; null when the item has never been shared.

**How uniqueness is tracked:** each table gets a **partial unique index** on `public_token` that only applies *where the token is not null*. This guarantees no two items in a table share a token, while still allowing unlimited unpublished items (which all have `null` and would otherwise collide). Tokens are unique *within* a type, not globally — that's fine because the URLs are type-scoped (`/public/bookmarks/...` vs `/public/notes/...`).

**Functional outcome:** purely structural — the schema can now represent "is this shared, and by what token." No behavior changes yet.

### M2 — The public read path (anonymous access)
**Functional outcome:** the three public read URLs go live. Anyone, with no auth, can `GET /public/{type}/{token}` and receive the item's content.

The rules that govern what comes back:
- **Published + active** → 200 with the content.
- **Archived but published** → still 200, but the response carries `is_archived: true` so the page can show an "archived" banner. (Archived content is still live content.) Whether something counts as archived reuses the existing logic that treats a *future-dated* archive as not-yet-archived.
- **Soft-deleted** → 404, always. Deleted content must never surface publicly — this is the hard rule.
- **Unknown token, or token belongs to an item that's been unpublished** → 404.

The public response is a **separate, locked-down schema** — it can only ever contain `title`, `description`, `content`, line-count metadata, `is_archived`, `created_at`, `updated_at` (plus `url` for bookmarks and `name`/`arguments` for prompts). Owner fields (`user_id`, `tags`, `relationships`, the raw `archived_at`, `is_public`, `public_token`) and the internal `id` are structurally excluded — the public surface is identified by the share token, not the database UUID — so they can't leak even as the owner-facing schemas evolve.

Two supporting behaviors land here:
- **Abuse protection:** because there's no user to rate-limit, requests are limited **by client IP** using the existing Redis infrastructure (conservative per-minute and per-day caps). The real visitor IP is read from the proxy's forwarding header, not the raw socket address, so the limit actually distinguishes visitors in production.
- **Caching:** public responses are marked publicly cacheable but **must revalidate every time**, so the bandwidth-saving "nothing changed → 304" path works while revocation stays instant.

### M3 — Share management (owner controls)
**Functional outcome:** owners get the publish/unpublish/rotate capability, exposed as **dedicated share endpoints** on the existing item routers (auth-required, owner-scoped).

- **Publish** → if the item has no token yet, generate one; set `is_public = true`. First publish mints the token; the URL is now live.
- **Unpublish** → set `is_public = false`, but **keep** the token. The URL stops resolving, but re-publishing later restores the identical URL.
- **Rotate** → mint a brand-new token regardless of current state, which permanently invalidates the previous URL. (A user can even rotate while unpublished, to pre-empt a stale link before re-sharing.)

**How sharing state is tracked / surfaced to the owner:**
- The lightweight **list view** of items now carries `is_public` (a boolean) — just enough to show a "shared" indicator next to items, without an extra fetch.
- The full **detail view** of an item additionally carries the actual `public_token`, so the detail page can build the shareable URL. The token deliberately does **not** appear in list responses — that keeps share tokens off bulk surfaces, including what the MCP servers serialize to AI agents.

**Key guarantee:** none of these operations bump `updated_at` or write a history entry, because they're not content changes. This is verified to work simply by *not assigning* `updated_at` (the column updates only on explicit assignment — no DB trigger or `onupdate` touches it).

### M4 — "Save a copy" (clone) endpoint
**Functional outcome:** a logged-in visitor can clone a public item into their own account via `POST /public/{type}/{token}/save`.

How the clone behaves:
- It looks the source up **by token** (same visibility rules as M2 — 404 for missing/unpublished/deleted), then creates a **brand-new, independent item** owned by the cloning user.
- **Copied:** `title`, `description`, `content` (plus `url` for bookmarks, and `name` and `arguments` for prompts).
- **Not copied:** tags, relationships, archived/shared state. The copy starts clean — active, unshared, no organizational metadata from the source.
- It reuses the normal create path, so the cloner's **quota, tier field-limits, and uniqueness rules all apply automatically**. If the source content is too large for the cloner's plan, or they're at their item quota, they get a descriptive error — not a crash.

**Conflict handling (the interesting cases):**
- **Prompts** must have unique names per user, so the clone tries the original name, then `{name}-copy`, then gives up with a clear 409 ("rename it before saving").
- **Bookmarks** must have unique URLs, so cloning one you already have produces a descriptive "you already have this bookmark" error — covering both the case where you have it active *and* the case where you have it archived. (The decision was to show an error rather than silently redirect to your existing copy; a "take me to it" affordance could come later.)

### M5 — The public-facing page (frontend read view)
**Functional outcome:** the routes `/shared/{type}/{token}` render a clean, read-only view of a shared item using the **existing detail components in a new `readOnly` mode** — no edit toolbar, no action menus, no history sidebar, no mutation shortcuts.

- An **anonymous** visitor sees the content plus a "Sign in to save a copy" prompt that, when clicked, sends them through login and returns them to the same shared URL.
- A **logged-in** visitor sees a working "Save a copy" button that calls the M4 endpoint and, on success, navigates them to their new copy.
- An **archived** shared item shows an "archived" banner.
- An **invalid token** shows a sensible not-found state.

Two notable mechanics: anonymous pages fetch through a **separate no-auth client** (the normal app client always tries to attach a login token, which would fail for logged-out visitors), and **prompts render through read-only CodeMirror** — which already has Jinja template highlighting — while notes/bookmarks render through the existing Milkdown read view.

### M6 — The owner's share UI (frontend controls)
**Functional outcome:** owners get a "Share" control on the item detail page that ties the whole feature together.

- Unshared item → a control that, when clicked, **publishes** and reveals the shareable URL.
- Shared item → shows the URL with a **copy button**, plus **"Stop sharing"** and **"Regenerate link."**
- The shareable URL is built as `{origin}/shared/{type}/{token}` from the token in the item's detail data.
- "Regenerate" asks for confirmation first ("anyone with the previous link will lose access"), then rotates.
- Because publish/unpublish use the dedicated endpoints, **toggling sharing never changes the item's displayed "last updated" time** — a visible payoff of the M3 design choice.

## Guiding decisions (read before any milestone)

**Public token, not item UUID.** The public URL is identified by a separate random token (`public_token`), not the item's UUID. This lets the owner revoke access by rotating or nullifying the token without touching the item itself, and avoids exposing internal IDs at a public surface. Token generation reuses `secrets.token_urlsafe(32)` for entropy (the same source `services/token_service.py` uses for PATs), **but the token is stored plaintext** — unlike PATs, which are hashed at rest and looked up by hash. The public token *is* the URL: an unguessable URL component, not a credential, and the lookup is a plaintext equality match (`public_token == token`). Do not mirror the PAT hashing path.

**Soft-deleted items are never returned.** A `GET /public/{type}/{token}` for a soft-deleted item returns 404. This is a correctness hard requirement: deleted content must never surface publicly.

**Archived items are returned with an archived indicator.** An archived item is still live content. The public response includes `is_archived: bool` (derived server-side from `archived_at`) so the frontend can render an archived banner. The raw `archived_at` timestamp is not exposed — it is internal lifecycle data.

**Public response schemas exclude tags, relationships, and owner identity.** Tags and relationships are personal organizational metadata that reveal the owner's private classification system and content structure — not content itself. `user_id`, `is_public`, and `public_token` are owner-only operational fields. The public schemas include: `title`, `description`, `content`, `content_metadata`, `is_archived`, `created_at`, `updated_at`, plus `url` for bookmarks (its core content) and `name`/`arguments` for prompts. The internal `id` is excluded — the public surface is identified by the share token, not the database UUID. `created_at`/`updated_at` are included because they are factual content properties (analogous to an article's publish date), not personal data.

**Reuse existing detail components with a `readOnly` prop.** Rather than forking the detail pages, the existing components gain a `readOnly` prop that suppresses all mutation UI (edit toolbar, action menus, archive/delete buttons, right sidebar panels, mutation keyboard shortcuts). The read-side rendering and metadata display stay shared. This threads through two layers — the route targets `pages/*Detail.tsx` (the wrapper that resolves the route param and owns fetch), which delegates to the large render components (`components/Note.tsx`, `components/Prompt.tsx`, etc.); both layers take `readOnly`, and the render components must be audited for unconditional `user`/auth assumptions. See M5 for the full scope — this is real work, not a one-line flag.

**Content rendering is type-specific (no Milkdown Jinja fix needed).** Notes and bookmarks are markdown prose — they render in **Milkdown readonly** (the formatted/rendered reading view), which works today. Prompts are Jinja templates and render in **CodeMirror read-only mode**, which already has Jinja syntax highlighting (`utils/markdownStyleExtension.ts`) and matches the primary authenticated prompt experience (a logged-in user views their prompt in CodeMirror; the public view is the same minus edit affordances). This deliberately avoids building a Milkdown Jinja highlighter — the original plan's "fix Milkdown readonly Jinja rendering" task is **dropped**; rendering prompts through the existing CodeMirror path is less work and lower risk.

**The only action on the public view is "Save a copy".** No other action icons are shown. The button is auth-aware: authenticated visitors see "Save a copy"; unauthenticated visitors see a login/signup prompt. `AuthProvider` already wraps the entire app tree (above all routes), so `useAuthStatus()` is safe to call from public route components. During Auth0's initialization (`isLoading: true`), render a neutral placeholder before branching.

**"Save a copy" is a backend-driven clone endpoint.** `POST /public/{type}/{token}/save` (auth required) fetches the source item by token server-side and creates a new item in the authenticated user's account. This avoids re-POSTing potentially large content from the frontend. Fields copied: `title`, `description`, `content`; for bookmarks also `url`; for prompts also `name` and `arguments`. Fields not copied: `tags`, `relationships`, `archived_at`, `is_public`, `public_token` — the clone is a fresh independent item with no organizational metadata from the source.

**Prompt name conflict strategy on clone.** Prompt names must be unique per user. The clone endpoint first tries the original name; on conflict, tries `{name}-copy`; on second conflict, returns 409 with a descriptive message (e.g., "A prompt named '{name}-copy' already exists in your account. Rename it before saving this copy."). No further iteration. Bookmark URL conflicts and field-limit violations (tier-dependent) are surfaced as descriptive errors using the existing error patterns.

**IP-based rate limiting via existing Redis infrastructure.** Public endpoints have no user context, so per-user rate limiting doesn't apply. A separate `check_ip_rate_limit()` function in `rate_limiter.py` uses IP-keyed Redis entries (key format: `rate:ip:{ip}:public:{window}`) with conservative limits appropriate for unauthenticated access. Fail-open on Redis unavailability, consistent with existing rate limiting behavior.

**Cache headers for public endpoints.** `ETagMiddleware` currently applies `Cache-Control: private, no-cache, Vary: Authorization` to all GET/JSON responses. For `/public/*` paths, this is wrong — `private` and `Vary: Authorization` don't apply to unauthenticated content. The middleware is extended to detect `/public/*` paths and apply `Cache-Control: public, max-age=0, must-revalidate` with no `Vary` header.

**Why `max-age=0, must-revalidate` rather than `max-age=60`?** Unpublish and rotate are sold as access *revocation* (see below). A `max-age=60` fresh-serve window means a browser or intermediary could keep serving revoked content for up to a minute after the owner cuts access — "Stop sharing" wouldn't actually be immediate. `max-age=0, must-revalidate` forces every request to revalidate against the ETag, so revocation takes effect immediately while the ETag/304 path still delivers the bandwidth savings (a 304 carries no body). At beta scale there is no load argument for serving stale public content. If a concrete CDN/crawler-volume driver appears later, revisit `max-age`.

This applies to **both** the 304 and the 200 response paths (see M2 — the 304 branch must not fall back to the private header set). Note: the clone endpoints (`POST /public/{type}/{token}/save`) are auth-required but share the `/public/*` prefix — `POST` requests are skipped by `ETagMiddleware` (it only processes `GET`), so no special handling is needed.

**Sharing is managed by dedicated endpoints, not the generic update path.** Publishing, unpublishing, and rotating the token are dedicated share operations — they are **not** an `is_public` field threaded through `PATCH /{type}/{id}`. Routing share-state changes through the content-update path would (a) bump `updated_at`, which the public view exposes as the content's "last updated" date, so merely sharing an item would make it appear freshly edited, and (b) write a `ContentHistory` entry for a non-content event. `updated_at` is bumped explicitly inside each service's `update()` (there is no column-level `onupdate`), so dedicated share methods that write only the sharing columns leave `updated_at` and history untouched for free. See M3.

**Token is generated on first publish, stable across updates.** Publishing an item generates a `public_token` if one doesn't exist. Subsequent content updates (title, content, tags, etc.) never regenerate the token — URLs stay stable. Unpublishing leaves the token in place (re-publishing restores the same URL). An explicit "rotate" action is the only way to invalidate the current token and generate a new one.

**URL scheme:**
- Public read API (no auth): `GET /public/bookmarks/{token}`, `/public/notes/{token}`, `/public/prompts/{token}`
- Clone API (auth required): `POST /public/bookmarks/{token}/save`, `/public/notes/{token}/save`, `/public/prompts/{token}/save`
- Share management API (auth required, owner only) — dedicated, on the existing type-specific routers:
  - Publish: `POST /bookmarks/{id}/share` (and `/notes/{id}/share`, `/prompts/{id}/share`)
  - Unpublish: `DELETE /bookmarks/{id}/share` (and notes/prompts)
  - Rotate: `POST /bookmarks/{id}/rotate-share-token` (and notes/prompts)
- Frontend: `/shared/bookmarks/{token}`, `/shared/notes/{token}`, `/shared/prompts/{token}` — routed under existing `PublicPageLayout`

---

## Milestone 1: Backend models and migration

### Goal & Outcome

Add the database columns and index needed to support public sharing across all three content types.

- All three models (`Bookmark`, `Note`, `Prompt`) have an `is_public` boolean field (default `False`) and a nullable `public_token` string field.
- Each table has a partial unique index on `public_token WHERE public_token IS NOT NULL`, ensuring token uniqueness per content type while allowing multiple unpublished items (all `NULL`).
- No behavioral changes yet — this milestone is purely schema.

### Implementation Outline

Add `is_public: Mapped[bool]` (default `False`, not nullable, server default `false`) and `public_token: Mapped[str | None]` (nullable, max 64 chars, indexed) to `Bookmark`, `Note`, and `Prompt` models. Follow the same mixin/column patterns already used in those files.

Each model's `__table_args__` gets a new `Index` entry using a partial `postgresql_where` clause on `public_token IS NOT NULL`, with `unique=True`. Follow the same pattern as the existing `uq_bookmark_user_url_active` and `uq_prompt_user_name_active` indexes in those models.

Create the migration with `make migration message="add public sharing fields to content models"`. Do not hand-author the migration file.

The `public_token` column is unique within each table but not globally across types (a bookmark and a note could theoretically share the same token value). That is acceptable because the public endpoints are type-scoped (`/public/bookmarks/{token}` vs `/public/notes/{token}`).

### Definition of Done

- Migration runs cleanly (`make migration` + `alembic upgrade head`) with no errors.
- Partial unique indexes are present on all three tables (verify with `\d bookmarks` etc.).
- Existing tests pass — no behavioral changes means no new failures.
- No application-level tests needed for this milestone beyond migration sanity.

---

## Milestone 2: Backend public read path

### Goal & Outcome

Anyone with a valid share token can fetch the full content of a published item, without authentication.

- `GET /public/bookmarks/{token}`, `GET /public/notes/{token}`, `GET /public/prompts/{token}` return item content for published, non-deleted items.
- Soft-deleted items return 404.
- Archived items return 200 with `is_archived: true` in the response body.
- Responses exclude tags, relationships, all owner identity fields, and the internal `id` (the share token is the public identifier). They include `title`, `description`, `content`, `content_metadata`, `is_archived`, `created_at`, and `updated_at`. Bookmarks also include `url`; prompts also include `name` and `arguments`.
- Responses use `Cache-Control: public, max-age=0, must-revalidate` and no `Vary: Authorization`.
- Requests are IP-rate-limited via existing Redis infrastructure.

### Implementation Outline

**Public item service** (`services/public_item_service.py`): New module, not a subclass of `BaseEntityService`. Implement three async functions — one per content type — that accept `(db: AsyncSession, token: str)` and return the item or `None`. Each query filters on `public_token == token AND is_public IS TRUE AND deleted_at IS NULL`. Archived items are included — do not filter them out. Eager-load `tag_objects` is not needed (tags are not in the public response). Populate `content_metadata` at the router by calling `apply_partial_read(resp, None, None)` (full content). `_attach_content_length` is *not* needed — the public schema exposes `content_metadata`, not `content_length`.

**Public router** (`api/routers/public.py`): New `APIRouter(prefix="/public", tags=["public"])`. The three GET endpoints have no auth dependencies. Each resolves the real client IP via the shared helper (see below), calls `check_ip_rate_limit()`, calls the public item service, returns 404 on `None`, returns 200 with the appropriate public response schema on success.

Register this router in `api/main.py` alongside the existing routers.

**Client IP extraction** — do **not** use `request.client.host` directly. Behind Railway's proxy that is the proxy's address for every visitor, so all public traffic would collapse into a single rate-limit bucket. Extract the helper (originally in `consent.py`) into a shared util (`core/request_utils.py`) and reuse it here. Header precedence: **`X-Real-IP` first** — Railway's docs (Public Networking → Specs & Limits → Request Headers) document it as *the* client-IP header, and it is edge-set / not client-settable — then `X-Forwarded-For` (first entry) and `request.client.host` as fallbacks for local dev / non-Railway hosts. Only the `X-Real-IP` path is spoof-resistant; the `X-Forwarded-For` fallback is client-settable, so the per-IP limit is best-effort abuse mitigation, not a hard control. The `X-Real-IP` behavior (incl. the forum-reported CDN-active edge case) is **unverified against real production traffic** — confirm from an observed production request before relying on it (tracked follow-up).

**IP rate limiting** (`core/rate_limiter.py`): Add `async def check_ip_rate_limit(ip: str) -> RateLimitResult`. Use the same Redis sliding-window logic as `check_rate_limit()` but keyed on `rate:ip:{ip}:public:min` (per-minute) and `rate:ip:{ip}:public:daily` (daily fixed window). Limits are `60/min`, `2000/day` (documented in `rate_limit_config.py`). They're generous because the 256-bit token already defeats enumeration, so this is abuse/DoS protection, not enumeration defense. Note the per-minute cap is the binding constraint: public responses use `max-age=0, must-revalidate`, so every view — including 304 cache revalidations — runs the route and consumes one token (the ETag is computed after the handler executes). Fail-open on Redis unavailability, consistent with the rest of the module.

**Cache headers** (`core/http_cache.py`): Add a `PUBLIC_CACHE_HEADERS` constant (`Cache-Control: public, max-age=0, must-revalidate`, no `Vary`). Introduce a small `headers_for(path)` helper that returns `PUBLIC_CACHE_HEADERS` when `path.startswith("/public/")` else `CACHE_HEADERS`, and use it in **both** branches of `ETagMiddleware.dispatch()` — the 304 branch and the final 200 response. The current 304 branch hardcodes `**CACHE_HEADERS` (`private, no-cache, Vary: Authorization`); leaving it "unchanged" would make a public path's revalidation response private and `Vary`-keyed, contradicting the 200 response — the helper fixes both consistently. `POST` requests are already skipped by the middleware so the clone endpoints added in M4 need no special handling here.

**Public response schemas**: Add `PublicBookmarkResponse`, `PublicNoteResponse`, `PublicPromptResponse` in the respective schema files. Fields included: `title`, `description`, `content`, `content_metadata`, `is_archived` (bool, derived from `archived_at` server-side), `created_at`, `updated_at`. Bookmarks also include `url` (its core content); prompts also include `name` and `arguments`. Fields explicitly excluded: `id` (internal UUID — the token is the public identifier), `user_id`, `tags`, `relationships`, `archived_at` (raw timestamp), `is_public`, `public_token`, `deleted_at`, `last_used_at`, `summary`.

`is_archived` is read from the existing `ArchivableMixin.is_archived` hybrid property (`models/base.py:93-120`), which already does the `archived_at <= now()` comparison (and correctly treats a future-dated `archived_at` as not-yet-archived). Set `is_archived = item.is_archived` when constructing the response — do not reimplement the comparison.

**Why separate public schemas rather than reusing `*Response`?** The existing schemas will gain `is_public` and `public_token` in M3, and they already expose `user_id` and `tags`. A separate public schema is the explicit contract that prevents owner-only fields from leaking, even as the owner schemas evolve.

### Definition of Done

Tests in `backend/tests/api/test_public.py`:
- `GET /public/bookmarks/{token}` returns 200 with content for a published, active item.
- Returns 200 for a published, archived item; response has `is_archived: true`.
- Returns 404 for an unknown token.
- Returns 404 for a valid token where `is_public` is `False`.
- Returns 404 for a soft-deleted item (even if token is valid and `is_public` is `True`).
- Same four cases for notes and prompts.
- Response body does not contain `user_id`, `tags`, `relationships`, or `archived_at`.
- Response body contains `created_at` and `updated_at`.
- Response headers include `Cache-Control: public, max-age=0, must-revalidate` and no `Vary: Authorization`.
- `ETagMiddleware` returns 304 on a second identical request with matching `If-None-Match`, **and that 304 response also carries `public, max-age=0, must-revalidate` with no `Vary`** (not the private header set).
- Authenticated endpoints (`/bookmarks/{id}`) still return `Cache-Control: private, no-cache` on both 200 and 304 — regression guard.
- An archived item returns `is_archived: true`; an item with a future-dated `archived_at` returns `is_archived: false`.
- IP rate limit: a request that exceeds the per-minute limit returns 429. Keying uses the resolved client IP — `X-Real-IP` when present (a rotating spoofed `X-Forwarded-For` cannot mint fresh buckets), falling back to `X-Forwarded-For` first-entry (two distinct forwarded IPs get independent buckets), not `request.client.host`.

---

## Milestone 3: Backend share management

### Goal & Outcome

Owners can publish, unpublish, and rotate the share token for any of their items, via dedicated share endpoints that do not touch content lifecycle (`updated_at`, history).

- Publishing an item generates a `public_token` if none exists and sets `is_public = true`. Unpublishing sets `is_public = false` and does not clear the token (so re-publishing restores the same URL).
- A dedicated "rotate" endpoint generates a new random token, invalidating the previous URL.
- None of these operations bump `updated_at` or write a `ContentHistory` entry — sharing is not a content change.
- The owner can see sharing state in both list and detail responses; the raw `public_token` is exposed only on the detail response.

### Implementation Outline

**Dedicated share endpoints** (on the existing type-specific routers, auth required via `get_current_user`, owner only — the item is fetched scoped to `user_id`):
- `POST /{type}/{id}/share` — publish: generate a `public_token` if the item has none, set `is_public = true`. Returns the item (detail response, including `public_token`).
- `DELETE /{type}/{id}/share` — unpublish: set `is_public = false`, leave `public_token` in place.
- `POST /{type}/{id}/rotate-share-token` — rotate: generate a new `public_token` regardless of current `is_public` state (a user may pre-rotate before re-enabling sharing). Returns the item.

**`is_public` is deliberately NOT added to the `*Update` schemas.** Routing share-state through `PATCH /{type}/{id}` would send it through `update()`, which bumps `updated_at` and writes history — wrong for a non-content event (see the guiding decision). Keep the content-update path untouched.

**Service layer**: Add dedicated methods (e.g. `set_share_state(db, user_id, item_id, *, enabled: bool)` and `rotate_share_token(db, user_id, item_id)`) — or a shared helper on `BaseEntityService`, since the logic is identical across the three types. Each method:
- Fetches the item scoped to `user_id` (404/`None` if not found), writes only the `is_public`/`public_token` columns, and flushes.
- Generates tokens with `secrets.token_urlsafe(32)`, stored plaintext.
- **Does not** set `updated_at` and **does not** record `ContentHistory`. Because `updated_at` is bumped only by explicit assignment inside `update()` (no column-level `onupdate` — verified in `models/base.py`), simply not assigning it preserves the prior value.
- The partial unique index on `public_token` makes a generated-token collision raise `IntegrityError`; at 256 bits of entropy this is astronomically unlikely, but the rotate/publish path should let it surface rather than silently swallow it (an unhandled 500 on a ~1-in-2^256 event is acceptable; a single retry is optional).

**Owner response schemas** (#10 — minimize token surface):
- Add `is_public: bool` to `BookmarkListItem`, `NoteListItem`, `PromptListItem` — the boolean is all the list view needs for a "shared" indicator.
- Add `public_token: str | None` **only** to the detail schemas `BookmarkResponse`, `NoteResponse`, `PromptResponse` (not the list items). The list view never constructs the share URL — the detail page does — so the token has no reason to appear in bulk list responses, which are also what the Content/Prompt MCP servers serialize to AI agents. Keeping the token off the list item avoids handing share tokens to every agent surface for no functional gain.

**Caching / conditional-request implication (deliberately deferred).** Because share operations change `is_public`/`public_token` in the detail/metadata response body *without* bumping `updated_at`, the `Last-Modified`/`If-Modified-Since` fast path on the owner detail and metadata GETs is an *incomplete* validator for those fields: a client revalidating with `If-Modified-Since` **alone** (no `If-None-Match`) can receive `304 Not Modified` and keep showing stale share state (e.g. a copied-but-rotated-away link). This is **not new to sharing** — archive and delete already change their response bodies (`archived_at`/`deleted_at`) without bumping `updated_at`, so they share the identical characteristic. The ETag (computed from the full body) *does* change and is correct for all of these, so every conformant client — the web app (browsers send `If-None-Match`; the share UI also refetches) — is unaffected. The gap only reaches a client that revalidates on `Last-Modified` alone (e.g. a future iOS/native client or a caching proxy). Decision: **do not** bump `updated_at` on share (that would make sharing look freshly edited and break consistency with archive/delete), and **do not** delete the `Last-Modified` fast path (it is a load-bearing, ~18-test optimization used across content/relationship reads). Instead this is documented for API consumers (the OpenAPI "Caching & conditional requests" overview + the detail-GET descriptions advise revalidating with the ETag) and tracked here. **Systemic fix, if/when a real `Last-Modified`-only consumer needs it** (e.g. the iOS app adds sharing on a `Last-Modified`-based networking layer): split the single `updated_at` into two signals — a displayed "content last edited" timestamp that stays stable across status changes, and a cache-validator timestamp/version that advances on share/archive/delete — applied uniformly to all three status operations, not just sharing.

### Definition of Done

Tests in existing service and router test files:
- `POST /{type}/{id}/share` on an item with no token generates a token and sets `is_public = true`; a subsequent normal content update (title, content, tags) does not change the token.
- Publishing leaves `updated_at` unchanged (no content change) and writes no `ContentHistory` entry.
- `POST /{type}/{id}/share` on an item with an existing token (previously shared, then unpublished) reuses the existing token.
- `DELETE /{type}/{id}/share` sets `is_public = false` and leaves the token unchanged.
- `POST /{type}/{id}/rotate-share-token` generates a new token (and writes no history); the old token no longer resolves via `GET /public/{type}/{old_token}`.
- Rotating when `is_public = false` works — token is updated regardless.
- `BookmarkListItem`/`NoteListItem`/`PromptListItem` expose `is_public` but **not** `public_token`; `BookmarkResponse`/`NoteResponse`/`PromptResponse` expose both `is_public` and `public_token`.
- Unauthenticated access to any share endpoint returns 401/403.
- All existing update tests still pass (regression) — in particular, normal content updates are unaffected by the new share path.

---

## Milestone 4: Backend clone endpoint

### Goal & Outcome

An authenticated user viewing a public item can save an independent copy to their own account with a single action.

- `POST /public/bookmarks/{token}/save`, `/public/notes/{token}/save`, `/public/prompts/{token}/save` create a new item in the authenticated user's account, sourced from the public item at that token.
- The clone is independent: it shares no state with the source item.
- Fields copied: `title`, `description`, `content`; for bookmarks also `url`; for prompts also `name` and `arguments`.
- Fields not copied: `tags`, `relationships`, `archived_at`, `is_public`, `public_token`. The clone starts as a fresh active item with no organizational metadata from the source.
- Prompt name conflicts are handled with a two-step fallback: try original name, then `{name}-copy`, then fail with a descriptive 409.
- Tier field-limit violations (source content exceeds cloner's plan limits) are surfaced as descriptive errors.

### Implementation Outline

**Clone endpoints** in `api/routers/public.py`: Three `POST` endpoints on the existing public router, each requiring auth via `Depends(get_current_user)`. The endpoints are auth-required while sitting under the `/public` prefix — this is intentional, as they operate on publicly-shared content identified by token.

Each endpoint:
1. Calls the public item service (same lookup as M2) to fetch the source by token. Returns 404 if not found or not public. Soft-deleted items are excluded (same rules as the read endpoints).
2. Constructs a `{Type}Create` payload from the copied fields only. No tags, no relationships, no `archived_at`.
3. Resolves the authenticated user's tier limits the same way normal create routes do (the `limits` argument `create()` requires — derived from the user's tier, via the same dependency/helper the existing `POST /{type}` routes use), then calls the appropriate existing service `create()` method with the authenticated user's `user_id`. This reuses all existing quota checks, field-limit enforcement, and uniqueness validation.
4. For prompts only: on `NameConflictError`, retry `create()` with `name=f"{original_name}-copy"`. On a second `NameConflictError`, return 409 with a message: `"A prompt named '{name}-copy' already exists in your account. Rename it before saving this copy."`. For bookmarks, the clone can hit **either** `DuplicateUrlError` (the URL is already an active bookmark) **or** `ArchivedUrlExistsError` (the user has the same URL archived) — both must be caught and mapped to a descriptive 4xx (not left to surface as a 500). The chosen UX is a descriptive "you already have this bookmark" error, consistent with existing create semantics — **not** a redirect to the existing copy (simpler, and matches what `POST /bookmarks` already does; a "take me to my existing copy" affordance can be a later enhancement).
5. Returns the newly created item using the owner's full response schema (same as a normal create response), so the frontend can immediately navigate to the new item.

**Why the clone endpoint lives in the public router, not the type-specific routers?** The operation is initiated from and semantically belongs to the public view — the source is identified by public token, not by the authenticated user's item ID. Placing it in `/bookmarks` would require a different URL shape and make the intent less clear.

**Why call the existing `create()` rather than a raw INSERT?** Reusing the service layer automatically applies quota enforcement, tier field-limit checks, and uniqueness validation without duplicating that logic. The clone is just a create with pre-populated fields.

### Definition of Done

Tests in `backend/tests/api/test_public.py`:
- `POST /public/notes/{token}/save` for an authenticated user creates a new note with the correct fields and returns it.
- Cloned item has `tags: []`, no relationships, `archived_at: null`, `is_public: false`.
- Cloning a prompt with a unique name creates it with the original name.
- Cloning a prompt whose name conflicts uses `{name}-copy` successfully.
- Cloning a prompt where both `name` and `{name}-copy` conflict returns 409 with the descriptive message.
- Cloning from a non-existent or unpublished token returns 404.
- Cloning from a soft-deleted item's token returns 404.
- Unauthenticated clone request returns 401.
- Cloning a bookmark whose URL the cloning user already has **active** returns a descriptive 4xx (`DuplicateUrlError` path, not a 500).
- Cloning a bookmark whose URL the cloning user already has **archived** returns a descriptive 4xx (`ArchivedUrlExistsError` path, not a 500).
- Cloning content that exceeds the user's tier field limits returns a descriptive error (not a 500).
- Quota exceeded (user at item limit) returns the appropriate quota error.
- All three content types covered.

---

## Milestone 5: Frontend public view pages

### Goal & Outcome

A public visitor who follows a share URL sees the full item content in a clean, read-only layout. The only action available is "Save a copy", rendered in an auth-aware way.

- Routes `/shared/bookmarks/:token`, `/shared/notes/:token`, `/shared/prompts/:token` resolve correctly using the existing `PublicPageLayout`.
- Archived items display an "archived" banner above the content.
- The existing detail components render in `readOnly` mode: no edit toolbar, no action menus, no right sidebar, no mutation keyboard shortcuts.
- The only visible action is "Save a copy": shows for authenticated users, shows a login/signup prompt for unauthenticated users, shows a neutral placeholder while auth is initializing.
- Notes/bookmarks render via Milkdown readonly; prompts render via read-only CodeMirror (which already highlights Jinja).

### Implementation Outline

**Routes**: Add three routes to `App.tsx` under the existing `PublicPageLayout` section:

```
/shared/bookmarks/:token  →  <BookmarkDetail readOnly />
/shared/notes/:token      →  <NoteDetail readOnly />
/shared/prompts/:token    →  <PromptDetail readOnly />
```

These lazy-load the same detail components as authenticated routes — no *new page* components, but `readOnly` threads through **two layers**: the route targets `pages/*Detail.tsx` (319–350 lines — resolves the route param and owns fetch), which delegates to the large render components (`components/Note.tsx` ~1020 lines, `components/Prompt.tsx` ~1285 lines). Both layers take `readOnly`. **Audit the render components for unconditional `user`/auth assumptions** (anything that reads the current user, fires a mutation on mount, or assumes an authenticated session) and gate it behind `!readOnly`. This is genuine work, not a one-line flag.

**`readOnly` prop on detail components**: Each detail component accepts `readOnly?: boolean`. When true:
- Route param is `token` (not `id`); item is fetched from `GET /public/{type}/{token}` via a new `usePublic{Type}(token)` hook backed by the no-auth `publicApi` client (see below).
- Mutation UI is not rendered and no mutation is fired. (Note: mutation hooks may still be *defined* at the top level — React's rules of hooks forbid calling them conditionally — the gating is on not rendering their UI and not invoking `.mutate()`, not on skipping the hook definitions.)
- The right sidebar (history panel) is not shown.
- Mutation keyboard shortcuts are disabled.
- An "archived" banner is shown when the response has `is_archived: true`.
- The only rendered action is the "Save a copy" control (see below).

**Auth-aware "Save a copy" control**: A single component that reads `isAuthenticated` and `isLoading` from `useAuthStatus()` (safe on public routes — `AuthProvider` wraps the entire app tree above all routes, including public ones). Behavior:
- `isLoading: true` → render a neutral placeholder (no button).
- `isAuthenticated: true` → render "Save a copy" button that triggers `POST /public/{type}/{token}/save` via a `useSavePublicItem(type, token)` hook. On success, navigate to the newly created item at `/app/{type}/{new_id}`. On error, surface a toast with the error message (handles the name-conflict 409 and quota errors).
- `isAuthenticated: false` → render a "Sign in to save a copy" prompt that redirects to the Auth0 login flow with a `returnTo` parameter pointing back to the current public URL.

**No-auth `publicApi` client (required, not optional)**: The shared axios instance (`services/api.tsx`) has a request interceptor that calls `getAccessToken()` on **every** non-dev request; for an unauthenticated Auth0 session that rejects with `login_required`, so any call through `api` from a public page throws *before* it reaches the server. Add a separate `publicApi` axios instance with **no auth interceptor** (just the base URL and response/error handling) and back the `usePublic{Type}` hooks with it. This is the hard blocker that makes the public page work for the logged-out visitor it's built for.

**Data fetching for public routes**: Add `usePublicBookmark(token)`, `usePublicNote(token)`, `usePublicPrompt(token)` hooks in `hooks/` that call the public read endpoints via `publicApi`. Only invoked when `readOnly` is true (use a query `enabled` flag or branch so the authed-path fetch doesn't also fire).

**Content rendering (type-specific — no Milkdown Jinja fix)**: Notes and bookmarks render their markdown content via **Milkdown readonly** (the formatted reading view), which works today — no change needed. Prompts render their Jinja template content via **CodeMirror in read-only mode**, which already highlights Jinja (`utils/markdownStyleExtension.ts`) and matches the authenticated prompt view (CodeMirror minus edit affordances). The originally-planned "fix Milkdown readonly Jinja rendering" task is **dropped** — there is no Milkdown Jinja highlighter to build. The only work here is ensuring the prompt readonly path routes content through CodeMirror's read-only mode (`editable: false` / read-only facet) rather than a Milkdown render.

**Why `readOnly` prop on existing components rather than separate public view components?** The detail components contain complex state management for editor lifecycle, content loading, and error handling that is valuable to reuse. A `readOnly` prop gates a subset of that behavior rather than reimplementing the read path from scratch.

### Definition of Done

- Navigating to `/shared/notes/{valid-token}` while unauthenticated renders note content with no edit or action UI, and shows a "Sign in to save a copy" prompt.
- Navigating to the same URL while authenticated shows a "Save a copy" button.
- "Save a copy" creates the item and navigates to it.
- The "Sign in to save a copy" prompt redirects to login with correct `returnTo`.
- The archived banner appears when `is_archived` is true.
- Navigating to `/shared/notes/{invalid-token}` shows a sensible not-found state.
- An unauthenticated visit to `/shared/notes/{valid-token}` fetches via `publicApi` and does **not** attempt to acquire an auth token (no `getAccessToken()` call / no `login_required` error).
- A shared **prompt** renders its template content in read-only CodeMirror with Jinja syntax highlighting.
- All three content types work.
- Authenticated users visiting a public URL see the read-only view (no redirect to `/app`).
- Existing authenticated routes are unaffected — regression: edit mode still works on `/app/notes/:id`.

### As-built refinements (delivered during M5 implementation + review)

Beyond the original outline above, M5 shipped a polished read-only experience. Captured here so reviewers can distinguish intended scope from drift:

- **Dedicated public page wrappers** (`PublicBookmark`/`PublicNote`/`PublicPrompt`) reuse the detail render components via a `readOnly` prop, rather than dual-moding the authed `*Detail` pages (approved deviation from the "no new page components" guideline — the wrappers stay thin; all reuse is in the render components).
- **True reader mode** in the editor stack (`ContentEditor` → `CodeMirrorEditor`): content is read-only **but selectable/copyable**; the formatting toolbar is hidden while view-only controls (wrap/lines/mono/reading/copy) stay; the character counter and focus chrome (outer ring + toolbar background/border) are suppressed.
- **Rendered "reading" view (Milkdown) is the default** for notes/bookmarks; prompts stay in CodeMirror source (Jinja). Reading-view **code blocks gained syntax highlighting** via `@milkdown/plugin-prism` + refractor (pinned to 7.18.0 to match the kit), restyled dark→light to match the source view.
- **Plain-text read-only rendering** for title/description (`InlineEditableTitle`/`Text`), bookmark URL as an external link (`InlineEditableUrl`), and prompt arguments (`ArgumentsBuilder` hides +/×/↑↓ and renders name/description/required as text).
- **"Save to Tiddly"** control (renamed from "Save a copy"), secondary/white style, placed above the title, with a logged-out "what is Tiddly" blurb linking to `/features` in a new tab.
- **Auth `returnTo`:** `AuthProvider` gained an `onRedirectCallback` that returns the user to the originating URL after login, sanitized to a same-origin relative path via `toSafeReturnTo` (open-redirect guard).
- **Logged-out limits fix:** `useLimits` is auth-gated, so the reused components spun forever for logged-out visitors; reader mode now falls back to a permissive `PUBLIC_VIEW_LIMITS` (only surfaced once dev mode was turned off — invisible in dev).

---

## Milestone 5.1: Complete the new-user save through an in-app save route

**Status:** Planned (not yet implemented). **Severity:** without this, a brand-new user who signs up from a share link **cannot save at all** — their first authenticated action is the save, which is consent-gated, and there is no consent UI on the public page. So this is not "smoothing"; it's what makes new-user save from a share link work. Consider prioritizing **before M6**, since converting share-link newcomers is the point of Public View. Independent of M6.

> **Approach changed after M5 review.** An earlier draft recreated the consent dialog on the public `/shared/*` page. That reintroduced the same reuse-mismatch the feature exists to avoid — the app's `ConsentDialog` is an accept-only, no-exit modal, wrong for a read-first public page — and contradicted itself on dismiss behavior. This version instead **routes the post-sign-up save through the authenticated app, where consent already works**, removing the need for any consent UI (or dismiss behavior) on the public page.

### Context / problem

The public clone endpoint (`POST /public/{type}/{token}/save`, M4) is auth **and consent** gated — `get_current_user` raises **451 (consent_required)** for any user who hasn't accepted the current Terms/Privacy (`core/auth.py` `_check_consent`).

A brand-new user who **signs up from a share link** is returned via Auth0 `appState.returnTo` (M5) — and M5 points that at the public share page. So their *first authenticated action is the save itself*, which 451s. The blocker: the consent dialog is mounted **only** by the authenticated `AppLayout` (`AppLayout.tsx:75` — `if (needsConsent === true) return <ConsentDialog/>`); `/shared/*` uses `PublicPageLayout`, which never mounts it, and the 451 interceptor (`api.tsx:215`) only sets a store flag — it renders nothing. So on the public page the new user gets a 451 with **no way to accept Terms** and is stuck.

This only affects the sign-up-from-share-link flow Public View creates. Already-consented users never see it (consent is one-time). But for the brand-new visitor — the exact person sharing is meant to convert — the first save is currently **non-functional**.

### Goal & Outcome

A logged-out / brand-new visitor clicks "Save to Tiddly" **once**, signs up, accepts Terms via the **existing in-app dialog**, and lands on their saved copy — no second click, and **no consent UI added to the public page**.

The new-user path becomes: read (no auth) → click Save → sign up → land in the app → accept Terms (existing `ConsentDialog`, unchanged) → the shared item is saved → navigate to the new copy at `/app/{type}/{new-id}`.

### Implementation Outline

Move the post-sign-up save **into the authenticated app**, where the consent gate already lives. Reuse the existing clone endpoint and `ConsentDialog` as-is; do **not** add consent UI to public routes, and do **not** touch `consentStore` or the global interceptor.

- **Repoint the sign-in `returnTo` (SaveACopy, anonymous branch).** Today the anonymous "Sign in to save" sets Auth0 `appState.returnTo` to the current shared URL. Change it to an **in-app save route that encodes the token**, e.g. `/app/save-shared/{type}/{token}`. `toSafeReturnTo` already permits this (same-origin relative path). The token is the entire payload needed — it identifies the item; the endpoint does the rest.
- **Add the in-app save route/component** (e.g. `SaveSharedRedirect`), registered under `ProtectedRoute → AppLayout` but **outside the normal `Layout` app chrome** — so it shows a focused saving/failed state without kicking off the sidebar/filters/tags fetches the app shell does. Because it's an app route, `AppLayout` **automatically enforces consent** (shows the existing dialog for a new user before rendering the route — no new consent UI). The component:
  - **Waits until consent is ready** before doing anything — using the same condition the app shell uses (`Layout.tsx:52`): `isDevMode || needsConsent === false`. (Plain `needsConsent === false` is wrong: `AppLayout` bypasses consent entirely in dev mode, leaving `needsConsent` at `null` → the route would spin on "Saving…" forever.) The wait is necessary because `AppLayout` optimistically renders children *during* the consent check (`AppLayout.tsx:47`), so firing on raw mount could send a premature 451.
  - Fires the save **exactly once** — guard the POST with a ref so a re-render, React StrictMode double-invoke, or `needsConsent` simply staying `false` across renders can't clone the item twice.
  - Then calls the existing clone endpoint (`POST /public/{type}/{token}/save`, via the existing save hook) and, on success, navigates to `/app/{type}/{new-id}`.
  - Reuses the existing clone error handling (prompt name conflict → `{name}-copy`/409, bookmark URL conflict, quota/field-limit). On a hard failure it lands the user somewhere sensible (e.g. their content list) with a descriptive toast — not a dead-end blank route. Shows a brief "Saving…" state while in flight, with a **timeout fallback** (land on the content list with a message) so a consent check that hangs without resolving can't leave the user spinning. (`AppLayout` already renders its own error screen if the consent check *errors*; the fallback covers the rarer no-error hang.)
- **Already-authenticated in-place save, with one addition for unconsented users.** When a logged-in user clicks Save on the public page, `useSavePublicItem` saves immediately and navigates to the copy (as today). The one change: if that in-place save returns **451** (logged in but not consented — see the re-consent population in Risks), `onError` **redirects to the same `/app/save-shared/{type}/{token}` route** instead of toasting. This unifies *both* consent paths through the one new route — the anonymous branch reaches it via `returnTo`, the authed-unconsented branch via redirect-on-451.

This retires the earlier draft's "suppress the 451 toast" and "auto-retry after consent" machinery: the **anonymous** save never fires on the public page (it runs once in the app, after consent), and the **authed-unconsented** 451 is handled by *redirecting* to the app save route rather than toasting. So a 451 branch still exists in `useSavePublicItem.onError` — it just redirects instead of showing a spurious failure; do **not** drop 451 handling.

### Alternatives considered

- **Recreate consent on the public page (the earlier M5.1 draft).** Render `ConsentDialog` on `/shared/*`, suppress the 451 toast, auto-retry after consent. Rejected: the app dialog is accept-only/no-exit (wrong on a read-first page), making it dismissable reintroduces the app-vs-public mismatch, and it duplicates consent UI plus retry machinery — all to avoid a redirect into the app that is actually the better destination.
- **Keep them on the share page and auto-retry the in-place save.** Same blocker — consent isn't reachable on the public page without recreating it.
- **Route the save through the app (this plan).** Reuses the existing consent gate and save endpoint; smallest new surface; lands the new user in their account looking at their copy.

### Risks

- **Save fires before consent resolves → premature 451.** Mitigation: gate the save on `isDevMode || needsConsent === false` (dev mode bypasses consent, so `needsConsent` stays `null`; mirror `Layout.tsx:52`), plus the fire-once ref guard.
- **Double-clone** from a re-render / StrictMode double-invoke / `needsConsent` staying `false`. Mitigation: the ref-guarded single fire above.
- **Consent check hangs (no error, no resolution).** Mitigation: the "Saving…" timeout fallback above. (`AppLayout` already covers the *error* case with its own retry screen.)
- **Save failure on the app route** (name/URL conflict, quota): surface a clear message and a sensible landing page, not a blank or looping route.
- **`returnTo` integrity:** the app save route is a same-origin relative path; keep the `toSafeReturnTo` guard (and its review hardening).
- **Logged-in but unconsented user saving in-place — the re-consent population (resolved above, not deferred).** This is *not* a rare anomaly: every time the Terms/Privacy version is bumped, **all** existing users become `needsConsent === true` until they re-accept, and any of them who opens a share link and clicks Save before re-consenting would otherwise hit the same 451-with-no-consent-UI dead-end. Resolved by the redirect-on-451 in the in-place save path (above), which routes them through the consent-enabled app save route — so this milestone covers both new signups *and* the re-consent population.

### Definition of Done

- A logged-out visitor clicks Save → signs up → accepts Terms in the **existing in-app dialog** → the item is saved and they land on `/app/{type}/{new-id}`, with **no second click and no consent UI on the public page**.
- A logged-out visitor who already has an account (already consented) clicks Save → signs in → item saved → lands on the copy, with **no** consent dialog.
- A **logged-in but unconsented** user (e.g. after a Terms-version bump) who clicks Save on the public page is routed to the app save route, accepts Terms, and the save completes — no dead-end 451.
- The in-app save route does **not** fire until consent is ready (`isDevMode || needsConsent === false`), fires **exactly once** (ref-guarded), and has a timeout fallback so a hung consent check can't spin "Saving…" indefinitely.
- A save failure (name/URL conflict, quota) lands the user on a sensible page with a descriptive message, not a dead-end.
- The authed in-place save is unchanged **except** it redirects to the app save route on 451 (no spurious toast).
- **No** changes to `stores/consentStore.ts`, `ConsentDialog`, or the global API interceptor.
- Tests: the anonymous "Sign in to save" sets `returnTo` to the in-app save route (with token); an in-place 451 redirects to that route (no toast); the save route waits for readiness, fires once, saves, and redirects; the error and timeout paths land sensibly; existing save tests still pass.

---

## Milestone 6: Frontend share UI

### Goal & Outcome

Item owners can publish, unpublish, and rotate the share token from within the item detail page.

- The detail page shows a "Share" action discoverable alongside other item actions.
- Toggling sharing on generates a shareable URL the user can copy; toggling off removes it from view.
- A "Regenerate link" action rotates the token with a confirmation step.

### Implementation Outline

**Share control placement**: Add a share control to the item detail action area alongside archive/delete/etc. The control has two states: unpublished (clicking publishes and reveals the URL) and published (shows URL + copy button + "Stop sharing" + "Regenerate link"). Exact visual treatment is implementation's judgment call — match the surrounding design language.

**Publish/unpublish**: Calls the dedicated share endpoints — `POST /{type}/{id}/share` to publish, `DELETE /{type}/{id}/share` to unpublish (**not** `PATCH /{type}/{id}` with `is_public` — that path is intentionally gone, see M3). On success, invalidates the query cache so `public_token` and `is_public` are reflected immediately. Because these endpoints don't bump `updated_at`, the detail page's "last updated" display won't shift when the user merely shares an item.

**Copy URL**: Constructs the shareable URL as `${window.location.origin}/shared/{type}/{token}` from `public_token` in the current item's **detail** data (the token is on the detail `*Response`, not the list item). Uses the clipboard API; shows a toast on success.

**Regenerate link**: Calls `POST /{type}/{id}/rotate-share-token`. Shows a confirmation before proceeding ("Anyone with the previous link will lose access. Continue?"). On success, invalidates the cache and displays the new URL.

**State source**: Sharing state comes from the item data already fetched by the detail page — `is_public` (also on the list item, for indicators) and `public_token` (detail response only) — no separate sharing-state endpoint needed.

### Definition of Done

- Toggling share on calls `POST /{type}/{id}/share` and displays the resulting URL.
- Toggling off calls `DELETE /{type}/{id}/share` and hides the URL.
- Sharing/unsharing an item does not change its displayed "last updated" time.
- Copy button copies the correct URL to the clipboard.
- Regenerate shows a confirmation, calls the rotate endpoint, and updates the displayed URL.
- All three content types have the share UI.
- Unauthenticated users visiting the public URL see the read-only view (handled by routing — no conditional rendering needed in the share UI itself).

---

## Milestone 7 (post-deployment): verify the public surface against production

**Status:** Pending deploy. Not a code milestone — these checks **cannot** be done locally or before merge, because the subject is **Railway's edge behavior** and the public surface does not exist in production until this feature ships (prod runs `main`, which has no `/public/*`). Do **not** block the M1–M6 merge on this: the per-IP limiter is fail-open and the 256-bit token already defeats enumeration, so this is coarse DoS mitigation, not access control. The "unverified" hedge is documented in `core/request_utils.py` and `docs/architecture.md` §17 precisely so it can ship and be confirmed afterward.

### Goal & Outcome

Confirm the unauthenticated public surface behaves safely in production, and either remove the `X-Real-IP` hedge or fix the header precedence based on what's actually observed.

### Tasks

**1. Verify `X-Real-IP` resolution (the per-IP limiter rests on it).** `get_client_ip`/`resolve_client_ip` (`core/request_utils.py`) trust `X-Real-IP` first as the spoof-resistant, edge-set client IP, falling back to the client-settable `X-Forwarded-For`. This is the assumption to confirm against a real prod request:
- After deploy, exercise a `/public/*` request from a known external IP (a bogus token works — the IP limiter at `public.py:enforce_public_ip_rate_limit` runs *before* the 404 lookup).
- Observe what the server resolved. The **permanent 429-rejection log** (added in this work — logs the resolved IP + `ip_source`) covers the throttled path; for the *allowed* path, add a **temporary** debug log of `resolve_client_ip(...)`, observe via `railway logs`, then revert it (do **not** leave per-request IP logging in prod — PII).
- Confirm three things: (a) `X-Real-IP` is present (`ip_source == "x-real-ip"`); (b) it equals the real client IP, not Railway's proxy; (c) it is **not** client-settable — send a forged `X-Real-IP` and confirm the edge overwrites it. Test with Railway's CDN feature in whatever state production runs (the reported failure case).
- **Outcome:** if confirmed, drop the "unverified" hedge in `request_utils.py` and §17. If it misbehaves, switch the primary source to whatever header carries the true client IP at the edge.

**2. Security pass on the new unauthenticated surface.** Per `AGENTS.md` "Security Tests" (changes to auth / API endpoints / input validation): review and extend `backend/tests/security/` and the live `deployed/test_live_penetration.py` for the public surface — random/invalid token → 404 (no owner-field leak, no 404-vs-403 oracle), soft-deleted token → 404, and the clone endpoint's auth/quota gates. Then run the deployed pen tests against production (**engineer-triggered**, per the usual).

### Notes

- **Ownership:** the verification + hedge removal can be done with Railway CLI access (read `railway logs`, exercise prod). Triggering the production **deploy** and the **deployed pen-test run** are the engineer's actions.
- **Permanent 429 IP log (already added):** logs the resolved client IP + source on public rate-limit *rejections only* (not the allowed path) — useful for abuse triage on an unauthenticated surface and fills the "Security Audit Logging" gap noted in `README.md`. IPs are PII; this is rejection-scoped and should be reflected in the privacy policy if not already covered.