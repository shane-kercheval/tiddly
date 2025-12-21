# Implementation Plan: Privacy Policy, Terms of Service, and Consent Tracking

**Date:** December 20, 2024
**Status:** Approved - Ready to Implement
**Goal:** Implement GDPR-compliant consent tracking with Privacy Policy and Terms of Service

---

## Overview

Implement a complete privacy and terms of service system including:
1. Privacy Policy and Terms of Service documents  
2. Dedicated pages to display them
3. Consent dialog on first login
4. Database tracking of user consent
5. Footer links across the application

---

## Requirements

### Legal Compliance
- ✅ GDPR: Explicit consent with proof (timestamp, version)
- ✅ CCPA: Privacy Policy disclosure
- ✅ Trackable consent for audit purposes

### User Experience
- ✅ One-time consent dialog after Auth0 login (for new users)
- ✅ Non-intrusive for users who already consented
- ✅ Easy access to Privacy Policy and Terms from anywhere
- ✅ Clear, readable policy pages

### Technical
- ✅ Database schema for consent tracking
- ✅ Backend API for recording consent
- ✅ Frontend enforcement (redirect to consent if not accepted)
- ✅ Version tracking for policy updates

---

## Database Schema

### New Table: `user_consents`

```sql
CREATE TABLE user_consents (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consented_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    privacy_policy_version VARCHAR NOT NULL,
    terms_of_service_version VARCHAR NOT NULL,
    ip_address VARCHAR,  -- Optional: helps prove consent
    user_agent TEXT,     -- Optional: additional proof
    UNIQUE(user_id)      -- One consent record per user
);

CREATE INDEX idx_user_consents_user_id ON user_consents(user_id);
```

**Notes:**
- `user_id`: Foreign key to users table
- `consented_at`: Timestamp for GDPR proof
- `*_version`: Track which version user agreed to (e.g., "2024-12-20")
- `ip_address`: Nullable - capture real client IP via X-Forwarded-For header when available (helpful for demonstrating consent)
- `user_agent`: Nullable - capture browser/client info for additional proof
- `UNIQUE(user_id)`: Each user has one consent record (update if they re-consent)

---

## Implementation Steps

### 1. Update Policy Documents

**Action:** Add your personal information to PRIVACY.md and TERMS.md

Items to fill in:
- `[your-email@example.com]` - Your contact email
- `[Your City, State, Country]` - Your location (GDPR data controller info)
- `[Your State, USA]` - Governing law jurisdiction

### 2. Database Migration

**Command:**
```bash
make migration message="add user consents table"
```

This will create: `backend/db/versions/XXXX_add_user_consents.py`

Migration should create the `user_consents` table with the schema above.

### 3. Backend Implementation

**New Files to Create:**
- `backend/src/models/user_consent.py` - SQLAlchemy model
- `backend/src/schemas/user_consent.py` - Pydantic schemas
- `backend/src/api/routers/consent.py` - API endpoints
- `backend/tests/test_consent.py` - Tests

**Endpoints:**
- `GET /consent/me` - Check if current user has consented
- `POST /consent/me` - Record consent (creates or updates)

**IP Address Capture:**
Implement proper X-Forwarded-For detection to capture real client IP:
```python
# Check forwarded headers first, fall back to direct client IP
ip = request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or \
     request.headers.get("X-Real-IP") or \
     request.client.host or None
```

Make nullable for graceful degradation when IP cannot be determined.

**Router Registration:**
Update `backend/src/api/main.py` to include consent router

**TODO Comment:**
Add comment in consent router noting this is frontend-enforced for beta, making it clear where to add backend middleware later if needed

### 4. Frontend Implementation

**New Files to Create:**
- `frontend/src/pages/PrivacyPolicy.tsx` - Privacy policy page
- `frontend/src/pages/TermsOfService.tsx` - ToS page
- `frontend/src/components/ConsentDialog.tsx` - Consent modal
- `frontend/src/components/AppLayout.tsx` - App container wrapper
- `frontend/src/stores/consentStore.ts` - Consent caching store
- `frontend/src/hooks/__tests__/useConsentCheck.test.ts` - Tests

**Files to Update:**
- `frontend/src/config.ts` - Add version constants
- `frontend/src/services/api.ts` - Add consent API methods
- `frontend/src/main.tsx` - Restructure routes to `/app` container

**Policy Version Constants:**
```typescript
export const PRIVACY_POLICY_VERSION = '2024-12-20'
export const TERMS_OF_SERVICE_VERSION = '2024-12-20'
```

### 5. Route Restructure (App Container Pattern)

**IMPORTANT: This restructure is part of THIS implementation (not deferred).**

**Change route structure to `/app` container for future-proofing:**

**Current routes:**
- `/` - Landing page
- `/bookmarks` - Main app

**New routes:**
- `/` - Landing page (public)
- `/privacy` - Privacy Policy page (public)
- `/terms` - Terms of Service page (public)
- `/app` - App container (authenticated, redirects to `/app/bookmarks`)
- `/app/bookmarks` - Bookmarks (main)
- `/app/settings` - Settings

**Future routes** (when notes/todos are added):
- `/app/notes` - Notes
- `/app/todos` - Todos

**Why:**
- Clean separation between marketing (`/`) and app (`/app`)
- Shared layout and auth logic for all app routes
- Easy to add new content types (notes, todos)
- Standard SaaS pattern (Todoist, Linear, etc.)
- Easier to restructure now (beta) than later with more users and features

**Migration:**
- Keep `/bookmarks` as redirect to `/app/bookmarks` for backward compatibility
- Update all internal links and navigation

**Dev Mode Handling:**
When `VITE_DEV_MODE=true`, consent checking should be bypassed entirely (similar to auth bypass). This enables smooth local development without requiring consent acceptance.

### 6. Consent Caching (Performance Optimization)

**Problem:** Checking consent on every route navigation would cause wasteful API calls

**Solution:** Cache consent status in Zustand store (in-memory only)

**Implementation:**
- Create `consentStore.ts` with consent state and actions
- Check consent once per session (on app load)
- Cache result in memory (Zustand)
- **Do NOT use localStorage** - keep it simple, avoid stale data issues

**Benefits:**
- One API call per session instead of per route
- Instant consent check on navigation
- Better performance and lower server load
- Simpler implementation without localStorage edge cases

**Integration:**
- Consent check happens in `AppLayout` wrapper component
- All `/app/*` routes inherit the consent status
- Dialog shows if consent missing or version mismatch
- Dev mode bypasses consent check entirely

### 7. Footer Component

Create footer with links to:
- Privacy Policy (`/privacy`)
- Terms of Service (`/terms`)
- License (`LICENSE.md` on GitHub)
- GitHub repository

**Placement:**
- Add to `Layout.tsx` (for authenticated users - visible on all `/app/*` pages)
- Add to `LandingPage.tsx` (for public access before signup)

Keep it simple and minimal at bottom of page.

---

## User Flow

### New User (First Login)
1. User authenticates via Auth0
2. App redirects to `/app` → automatically redirects to `/app/bookmarks`
3. `AppLayout` component checks consent status via `GET /consent/me` (cached in Zustand)
4. No consent found → Show ConsentDialog (modal)
5. Dialog blocks all app interaction until accepted
6. User checks "I agree" checkbox
7. User clicks "Accept and Continue"
8. Frontend calls `POST /consent/me` with versions
9. Backend records consent with timestamp, IP, user agent
10. Dialog closes, user can use app

### Existing User (Has Consented)
1. User authenticates via Auth0
2. App redirects to `/app/bookmarks`
3. `AppLayout` checks consent from Zustand cache (no API call if already checked)
4. Consent found with matching versions → No dialog shown
5. User can use app normally

### Policy Update Scenario
1. You update PRIVACY.md or TERMS.md
2. You update version constants in `config.ts`
3. Deploy changes
4. Next login, users see ConsentDialog again (version mismatch)
5. Users must re-consent to continue using app

---

## Testing Strategy

### Backend Tests

**File:** `backend/tests/test_consent.py`

Test scenarios:
1. ✅ GET /consent/me returns 404 for user with no consent
2. ✅ POST /consent/me creates new consent record
3. ✅ GET /consent/me returns consent after creation
4. ✅ POST /consent/me updates existing consent (doesn't duplicate)
5. ✅ Consent includes IP address (from X-Forwarded-For) and user agent
6. ✅ Consent gracefully handles missing IP/user agent (nullable fields)
7. ✅ Consent requires authentication
8. ✅ Deleting user cascades to consent record

### Frontend Tests

**File:** `frontend/src/hooks/__tests__/useConsentCheck.test.ts` or similar test files

Unit test scenarios:
1. ✅ Returns needsConsent=true when no consent exists
2. ✅ Returns needsConsent=false when consent exists with matching versions
3. ✅ Returns needsConsent=true when versions don't match
4. ✅ handleConsent() records consent and updates state
5. ✅ Dev mode bypasses consent check entirely

Integration test scenarios:
1. ✅ Full flow: login → consent dialog appears → accept → app access granted
2. ✅ Policy version mismatch triggers re-consent dialog
3. ✅ Public routes (`/privacy`, `/terms`) accessible without authentication
4. ✅ Existing user with valid consent doesn't see dialog on login
5. ✅ Consent dialog blocks all app interaction until accepted

### Manual Testing Checklist

- [ ] New user sees consent dialog on first login
- [ ] Dialog blocks app access until accepted
- [ ] Checkbox must be checked to enable "Accept" button
- [ ] Privacy/Terms links open in new tab
- [ ] After consent, dialog closes and user can use app
- [ ] Existing user (with consent) doesn't see dialog on login
- [ ] Database record created with correct timestamp
- [ ] IP address (X-Forwarded-For) and user agent captured when available
- [ ] Consent succeeds even if IP/user agent unavailable
- [ ] Footer links work on all pages (authenticated and landing page)
- [ ] Public routes (`/privacy`, `/terms`) work without authentication
- [ ] Updating version constants shows dialog again
- [ ] Dev mode bypasses consent entirely

---

## Enforcement Strategy

### Frontend Only (Recommended for Beta)

**Current Plan:**
- Consent enforced via frontend dialog
- API endpoints are open (can be called without consent)
- Personal Access Tokens bypass consent check

**Rationale:**
1. Beta has trusted users
2. API users (PATs) are power users who read docs
3. Simpler implementation
4. Can add backend enforcement later if needed

**Limitations:**
- Can be bypassed with direct API calls (curl, Postman)
- Not enforced for programmatic access

### Backend Enforcement (Future Option)

If stricter enforcement is needed:
- Add middleware to check consent on all protected routes
- Return HTTP 451 (Unavailable For Legal Reasons) if no consent
- Exempt certain endpoints (health check, consent endpoints)

**Decision:** Start with frontend-only, add backend enforcement if needed

**Implementation Note:** Add a TODO comment in `backend/src/api/routers/consent.py` indicating where backend middleware could be added for future enforcement, making it easy to find and implement later.

---

## Deployment Plan

### Phase 1: Development
1. Implement backend changes
2. Implement frontend changes
3. Run tests locally
4. Test in dev environment with Auth0 dev mode

### Phase 2: Pre-Production
1. Fill in personal info in PRIVACY.md and TERMS.md
2. Review policies for accuracy
3. Test with real Auth0 authentication
4. Manual QA using checklist above

### Phase 3: Production Deployment
1. Run database migration: `make migrate`
2. Deploy backend code
3. Deploy frontend code
4. Monitor logs for errors
5. Test with real account

### Phase 4: Post-Deployment
- All existing users will see consent dialog on next login
- Monitor for issues or confusion
- Be prepared to answer questions

---

## Open Questions & TODOs

**Before Implementation:**
1. [✅] Add your email to PRIVACY.md and TERMS.md - DONE
2. [✅] Add your location to PRIVACY.md - DONE (West Richland, WA, USA)
3. [✅] Add jurisdiction to TERMS.md - DONE (Washington State, USA)
4. [ ] Decide: Do you want to form an LLC before deploying this? (Recommended but not required for beta)

**Optional Future Enhancements:**
- [ ] Add backend consent enforcement (middleware)
- [ ] Add consent withdrawal mechanism (beyond account deletion)
- [ ] Add data export tool (GDPR "right to portability")
- [ ] Add email notifications when policies change
- [ ] Add audit log for consent changes

---

## Files Summary

### Already Created ✅
- `PRIVACY.md` - Privacy Policy document
- `TERMS.md` - Terms of Service document
- `LICENSE` - Elastic License 2.0
- `LICENSE.md` - License explanation

### To Create (Backend)
- `backend/db/versions/XXXX_add_user_consents.py` - Migration
- `backend/src/models/user_consent.py` - Model
- `backend/src/schemas/user_consent.py` - Schemas  
- `backend/src/api/routers/consent.py` - Router
- `backend/tests/test_consent.py` - Tests

### To Create (Frontend)
- `frontend/src/pages/PrivacyPolicy.tsx` - Policy page
- `frontend/src/pages/TermsOfService.tsx` - ToS page
- `frontend/src/components/ConsentDialog.tsx` - Consent modal
- `frontend/src/components/AppLayout.tsx` - App container wrapper
- `frontend/src/stores/consentStore.ts` - Consent caching (Zustand)
- `frontend/src/hooks/__tests__/useConsentCheck.test.ts` - Tests

### To Update
- `frontend/src/config.ts` - Add version constants
- `frontend/src/services/api.ts` - Add consent API calls
- `frontend/src/App.tsx` - Restructure routes to `/app` container (add public routes for privacy/terms)
- `frontend/src/components/Layout.tsx` - Add footer component
- `frontend/src/pages/LandingPage.tsx` - Add footer component
- Update all navigation/links to use new `/app/*` routes
- `backend/src/api/main.py` - Register consent router
- `backend/src/api/routers/consent.py` - Add TODO comment about future backend enforcement

---

## Estimated Effort

- **Backend:** 2-3 hours (model, schema, router, tests, migration)
- **Frontend:** 3-4 hours (pages, dialog, hook, integration, tests)
- **Testing:** 2 hours (manual QA, fix issues)
- **Documentation:** 1 hour (update policies with personal info)
- **Total:** ~8-10 hours

---

## Success Criteria

✅ All criteria must be met before deployment:

1. **Legal Compliance**
   - [ ] Privacy Policy is complete and accurate
   - [ ] Terms of Service is complete and accurate
   - [ ] Personal contact information added to both
   - [ ] Consent is trackable (timestamp, version, IP)

2. **User Experience**
   - [ ] New users see clear consent dialog
   - [ ] Dialog requires affirmative checkbox action
   - [ ] Links to policies work and open in new tabs
   - [ ] Existing users can use app without interruption

3. **Technical**
   - [ ] Database migration runs successfully
   - [ ] All backend tests pass
   - [ ] All frontend tests pass
   - [ ] Consent recorded correctly in database
   - [ ] Version tracking works for policy updates

4. **GDPR Compliance**
   - [ ] Can demonstrate user consent (timestamp, version)
   - [ ] User knows what they're consenting to (clear policies)
   - [ ] Consent is freely given (checkbox, not pre-checked)
   - [ ] Users can delete data (existing account deletion)

---

## Updating Policies in the Future

When you need to update PRIVACY.md or TERMS.md:

1. **Update the policy document** (PRIVACY.md or TERMS.md)
2. **Update "Last Updated" date** in the policy file
3. **Update version constant** in `frontend/src/config.ts`:
   ```typescript
   export const PRIVACY_POLICY_VERSION = '2025-01-15'  // New date
   export const TERMS_OF_SERVICE_VERSION = '2025-01-15'  // New date
   ```
4. **Deploy changes**
5. **Result:** All users will see consent dialog again on next login (version mismatch)

**Important:** Users MUST re-consent when policies change. The version check ensures this happens automatically.

---

## Architectural Decisions Made

**✅ Approved Changes:**
1. Route restructure to `/app` - proceed NOW as part of this implementation
2. Dev mode bypass - skip consent entirely when `VITE_DEV_MODE=true`
3. X-Forwarded-For IP detection - implement proper forwarded-header IP capture (nullable)
4. In-memory caching only - no localStorage, keep it simple
5. Footer placement - both Layout.tsx and LandingPage.tsx
6. Enhanced test coverage - integration tests, version mismatch, public routes
7. Frontend-only enforcement with TODO comment for future backend enforcement

**✅ Pre-Implementation Complete:**
1. PRIVACY.md - filled in with personal information
2. TERMS.md - filled in with personal information and jurisdiction
3. LICENSE - Elastic License 2.0 applied
4. LICENSE.md - plain English explanation created

## Next Steps

**Implementation approved - proceed with development:**
1. Create database migration
2. Implement backend (model, schema, router, tests)
3. Implement frontend (pages, dialog, store, layout changes, tests)
4. Run full test suite
5. Manual QA using checklist
6. Deploy to production
