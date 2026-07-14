"""Service layer for user creation and deletion."""
import logging
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from models.content_filter import ContentFilter
from models.deleted_identity import DeletedIdentity
from models.user import User
from services import content_filter_service

logger = logging.getLogger(__name__)


async def acquire_identity_lock(
    db: AsyncSession,
    provider: str,
    identifier: str,
) -> None:
    """
    Transaction-scoped advisory lock serializing identity lifecycle changes.

    Taken by the two operations that must not interleave for the same
    identity: JIT user creation (core/auth.get_or_create_user, create path
    only — cache hits and plain lookups never lock) and account deletion
    (delete_user_by_external_auth_id). Without it, an unknown-identity
    deletion webhook and that identity's first-ever API request can each pass
    the other's existence check and commit both a tombstone and a fresh user
    row (M8 review finding).

    Keys are provider-namespaced ("clerk:<sub>" / "auth0:<sub>") and hashed
    with 64-bit hashtextextended. Deletion acquires clerk-then-auth0 in that
    fixed order; creation acquires exactly one lock — a single-lock acquirer
    can't complete a deadlock cycle. Released automatically at transaction
    end (pg_advisory_xact_lock).
    """
    await db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(f"{provider}:{identifier}", 0),
            ),
        ),
    )


async def create_user_with_defaults(
    db: AsyncSession,
    *,
    auth0_id: str | None = None,
    external_auth_id: str | None = None,
    email: str | None = None,
    email_verified: bool | None = None,
) -> User:
    """
    Create a user and default content filters.

    Exactly one provider identifier is required — whichever the verified token
    supplied (Auth0 `sub` or Clerk `sub`). The users table CHECK constraint
    (`ck_user_has_identity`) backstops this at the database level.
    """
    if (auth0_id is None) == (external_auth_id is None):
        raise ValueError(
            "Exactly one of auth0_id or external_auth_id is required to create a user.",
        )
    user = User(
        auth0_id=auth0_id,
        external_auth_id=external_auth_id,
        email=email,
        email_verified=email_verified,
    )
    db.add(user)
    await db.flush()
    # New user has no consent - set explicitly to avoid lazy load
    user.consent = None
    await content_filter_service.ensure_default_filters(db, user.id)
    return user


@dataclass
class UserDeletionResult:
    """
    Outcome of a deletion, carrying the identifiers the caller needs for
    post-commit auth-cache invalidation (the service itself never touches the
    cache — invalidating before the transaction commits opens a window where
    a concurrent request repopulates the cache from the still-visible row).
    """

    deleted: bool
    user_id: UUID | None
    auth0_id: str | None
    external_auth_id: str


async def delete_user_by_external_auth_id(
    db: AsyncSession,
    external_auth_id: str,
) -> UserDeletionResult:
    """
    Delete the user identified by a Clerk user ID: lock, tombstone, cascade.

    The application-level delete-user path (called by the Clerk `user.deleted`
    webhook handler). In order:

    1. Acquire the identity advisory lock(s) — clerk first, then auth0 if the
       row carries one — serializing against JIT creation for the same
       identity (see acquire_identity_lock).
    2. Tombstone every provider identity the row carries in
       `deleted_identities` — `external_auth_id` blocks the Clerk JIT path,
       `auth0_id` (when present) blocks the Auth0/iOS path, whose sessions
       stay refreshable for the whole dual-accept window. For an unknown
       identity (already deleted, or never provisioned), tombstone the Clerk
       ID alone. Inserts use ON CONFLICT DO NOTHING against the unique
       identity indexes, so replayed deliveries are idempotent.
    3. Bulk-delete the user's content_filters (one set-based statement; the
       DB cascades filters -> groups -> filter_group_tags without touching
       tags, so the RESTRICT constraint on filter_group_tags.tag_id never
       fires), then delete the user row — the database cascades everything
       else. Two constant statements regardless of account size; no ORM
       collection is ever loaded (see the passive_deletes notes on
       models/user.py; end-state exercised by test_user_cascade.py).

    Idempotent: replays and unknown identities tombstone-and-succeed.
    Uses flush(), not commit — the caller's session owns the transaction.
    The CALLER must invalidate the auth cache for every returned identifier
    AFTER committing (see api/routers/webhooks.py; the consent router
    established the commit-then-invalidate pattern).
    """
    await acquire_identity_lock(db, "clerk", external_auth_id)

    result = await db.execute(
        select(User).where(User.external_auth_id == external_auth_id),
    )
    user = result.scalar_one_or_none()
    if user is not None and user.auth0_id:
        await acquire_identity_lock(db, "auth0", user.auth0_id)

    tombstone = pg_insert(DeletedIdentity).values(
        id=uuid7(),
        auth0_id=user.auth0_id if user else None,
        external_auth_id=external_auth_id,
    ).on_conflict_do_nothing()
    await db.execute(tombstone)

    if user is None:
        # Unknown identity: possibly a replay after a completed deletion, or a
        # Clerk user that never touched the API. The tombstone above still
        # guards the JIT paths.
        logger.info(
            "user_delete_unknown_identity external_auth_id=%s (tombstoned)",
            external_auth_id,
        )
        return UserDeletionResult(
            deleted=False,
            user_id=None,
            auth0_id=None,
            external_auth_id=external_auth_id,
        )

    user_id = user.id
    auth0_id = user.auth0_id
    # Filters first, set-based: this statement's cascades stop at the
    # association rows, clearing them before the user delete cascades tags.
    await db.execute(delete(ContentFilter).where(ContentFilter.user_id == user_id))
    await db.delete(user)
    await db.flush()

    logger.info(
        "user_deleted user_id=%s external_auth_id=%s auth0_id=%s",
        user_id,
        external_auth_id,
        auth0_id,
    )
    return UserDeletionResult(
        deleted=True,
        user_id=user_id,
        auth0_id=auth0_id,
        external_auth_id=external_auth_id,
    )
