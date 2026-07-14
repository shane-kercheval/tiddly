"""Tombstones for deleted identities (anti-resurrection guard)."""
from sqlalchemy import CheckConstraint, String
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, TimestampMixin, UUIDv7Mixin


class DeletedIdentity(Base, UUIDv7Mixin, TimestampMixin):
    """
    Tombstone for a deleted user's provider identities.

    Written by the account-deletion path (Clerk `user.deleted` webhook) and
    checked by JIT provisioning before creating a user: a still-live token for
    a deleted identity (a not-yet-expired Clerk JWT, or an Auth0 session kept
    alive by refresh tokens on iOS) must not resurrect an empty user row.

    Tombstones block dead credentials, not people: providers never reuse
    identity IDs, so a deleted user who signs up again arrives as a brand-new
    identity no tombstone matches.

    Retention: rows are NOT swept during the dual-accept window — Auth0-side
    entries must survive until M6b decommissions the Auth0 path (a fixed
    retention added earlier could silently reopen the resurrection hole).
    The sweep lands in M6b as part of the existing daily cleanup task.
    """

    __tablename__ = "deleted_identities"
    __table_args__ = (
        CheckConstraint(
            "(auth0_id IS NOT NULL) OR (external_auth_id IS NOT NULL)",
            name="ck_deleted_identity_has_identity",
        ),
    )

    # id provided by UUIDv7Mixin
    auth0_id: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=True,
        comment="Auth0 'sub' of the deleted user - blocks the Auth0/iOS JIT path",
    )
    external_auth_id: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=True,
        comment="Clerk user ID ('sub') of the deleted user - blocks the Clerk JIT path",
    )
