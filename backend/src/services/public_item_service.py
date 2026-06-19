"""
Read-only lookups for publicly shared items, keyed by share token.

These power the unauthenticated ``/public/*`` endpoints. They are intentionally
NOT part of ``BaseEntityService``: there is no user scoping (the unguessable
token is the authorization), and only a narrow read path is needed.

A published item is one with ``is_public = TRUE`` and a matching ``public_token``
that has not been soft-deleted. Archived items ARE returned — an archived item
is still live content; the caller surfaces ``is_archived`` on the response.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.bookmark import Bookmark
from models.note import Note
from models.prompt import Prompt


async def get_public_bookmark(db: AsyncSession, token: str) -> Bookmark | None:
    """Return the published, non-deleted bookmark for a share token, else None."""
    result = await db.execute(
        select(Bookmark).where(
            Bookmark.public_token == token,
            Bookmark.is_public.is_(True),
            Bookmark.deleted_at.is_(None),
        ),
    )
    return result.scalar_one_or_none()


async def get_public_note(db: AsyncSession, token: str) -> Note | None:
    """Return the published, non-deleted note for a share token, else None."""
    result = await db.execute(
        select(Note).where(
            Note.public_token == token,
            Note.is_public.is_(True),
            Note.deleted_at.is_(None),
        ),
    )
    return result.scalar_one_or_none()


async def get_public_prompt(db: AsyncSession, token: str) -> Prompt | None:
    """Return the published, non-deleted prompt for a share token, else None."""
    result = await db.execute(
        select(Prompt).where(
            Prompt.public_token == token,
            Prompt.is_public.is_(True),
            Prompt.deleted_at.is_(None),
        ),
    )
    return result.scalar_one_or_none()
