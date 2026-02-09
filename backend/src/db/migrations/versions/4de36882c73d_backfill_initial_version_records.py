"""backfill initial version records for existing entities

Revision ID: 4de36882c73d
Revises: a6bf6790021d
Create Date: 2026-02-07 13:04:52.688386

Creates version 1 (CREATE action) history records for all existing bookmarks,
notes, and prompts. This provides a baseline snapshot that users can revert to
after making their first edit.

Records use auth_type='dev' as a marker to identify backfilled records for
downgrade purposes (auth_type='dev' is never used in production).
"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from uuid6 import uuid7


# revision identifiers, used by Alembic.
revision: str = '4de36882c73d'
down_revision: Union[str, Sequence[str], None] = 'a6bf6790021d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create initial version records for all existing entities."""
    conn = op.get_bind()

    # Get all bookmarks that don't already have a version 1 history record
    bookmarks = conn.execute(sa.text("""
        SELECT
            b.id,
            b.user_id,
            b.title,
            b.description,
            b.content,
            b.url,
            b.created_at,
            COALESCE(
                (SELECT json_agg(t.name ORDER BY t.name)
                 FROM bookmark_tags bt
                 JOIN tags t ON t.id = bt.tag_id
                 WHERE bt.bookmark_id = b.id),
                '[]'::json
            ) as tags
        FROM bookmarks b
        WHERE b.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM content_history ch
              WHERE ch.entity_type = 'bookmark'
                AND ch.entity_id = b.id
                AND ch.version = 1
          )
    """)).fetchall()

    # Get all notes that don't already have a version 1 history record
    notes = conn.execute(sa.text("""
        SELECT
            n.id,
            n.user_id,
            n.title,
            n.description,
            n.content,
            n.created_at,
            COALESCE(
                (SELECT json_agg(t.name ORDER BY t.name)
                 FROM note_tags nt
                 JOIN tags t ON t.id = nt.tag_id
                 WHERE nt.note_id = n.id),
                '[]'::json
            ) as tags
        FROM notes n
        WHERE n.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM content_history ch
              WHERE ch.entity_type = 'note'
                AND ch.entity_id = n.id
                AND ch.version = 1
          )
    """)).fetchall()

    # Get all prompts that don't already have a version 1 history record
    prompts = conn.execute(sa.text("""
        SELECT
            p.id,
            p.user_id,
            p.name,
            p.title,
            p.description,
            p.content,
            p.arguments,
            p.created_at,
            COALESCE(
                (SELECT json_agg(t.name ORDER BY t.name)
                 FROM prompt_tags pt
                 JOIN tags t ON t.id = pt.tag_id
                 WHERE pt.prompt_id = p.id),
                '[]'::json
            ) as tags
        FROM prompts p
        WHERE p.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM content_history ch
              WHERE ch.entity_type = 'prompt'
                AND ch.entity_id = p.id
                AND ch.version = 1
          )
    """)).fetchall()

    # Build insert values for content_history
    history_records = []

    # Process bookmarks
    for row in bookmarks:
        tags = row.tags if isinstance(row.tags, list) else json.loads(row.tags) if row.tags else []
        metadata = {
            "title": row.title,
            "description": row.description,
            "tags": tags,
            "url": row.url,
        }
        history_records.append({
            "id": str(uuid7()),
            "user_id": str(row.user_id),
            "entity_type": "bookmark",
            "entity_id": str(row.id),
            "action": "create",
            "version": 1,
            "diff_type": "snapshot",
            "content_snapshot": row.content,
            "content_diff": None,
            "metadata_snapshot": json.dumps(metadata),
            "source": "web",
            "auth_type": "dev",
            "token_prefix": None,
            "created_at": row.created_at,
        })

    # Process notes
    for row in notes:
        tags = row.tags if isinstance(row.tags, list) else json.loads(row.tags) if row.tags else []
        metadata = {
            "title": row.title,
            "description": row.description,
            "tags": tags,
        }
        history_records.append({
            "id": str(uuid7()),
            "user_id": str(row.user_id),
            "entity_type": "note",
            "entity_id": str(row.id),
            "action": "create",
            "version": 1,
            "diff_type": "snapshot",
            "content_snapshot": row.content,
            "content_diff": None,
            "metadata_snapshot": json.dumps(metadata),
            "source": "web",
            "auth_type": "dev",
            "token_prefix": None,
            "created_at": row.created_at,
        })

    # Process prompts
    for row in prompts:
        tags = row.tags if isinstance(row.tags, list) else json.loads(row.tags) if row.tags else []
        # arguments is already JSONB from the database
        arguments = row.arguments if isinstance(row.arguments, list) else json.loads(row.arguments) if row.arguments else []
        metadata = {
            "title": row.title,
            "description": row.description,
            "tags": tags,
            "name": row.name,
            "arguments": arguments,
        }
        history_records.append({
            "id": str(uuid7()),
            "user_id": str(row.user_id),
            "entity_type": "prompt",
            "entity_id": str(row.id),
            "action": "create",
            "version": 1,
            "diff_type": "snapshot",
            "content_snapshot": row.content,
            "content_diff": None,
            "metadata_snapshot": json.dumps(metadata),
            "source": "web",
            "auth_type": "dev",
            "token_prefix": None,
            "created_at": row.created_at,
        })

    # Bulk insert all history records
    if history_records:
        conn.execute(
            sa.text("""
                INSERT INTO content_history (
                    id, user_id, entity_type, entity_id, action, version,
                    diff_type, content_snapshot, content_diff, metadata_snapshot,
                    source, auth_type, token_prefix, created_at
                ) VALUES (
                    :id, :user_id, :entity_type, :entity_id, :action, :version,
                    :diff_type, :content_snapshot, :content_diff, CAST(:metadata_snapshot AS jsonb),
                    :source, :auth_type, :token_prefix, :created_at
                )
            """),
            history_records
        )

    # Log summary
    bookmark_count = len(bookmarks)
    note_count = len(notes)
    prompt_count = len(prompts)
    print(f"Created {len(history_records)} initial version records: "
          f"{bookmark_count} bookmarks, {note_count} notes, {prompt_count} prompts")


def downgrade() -> None:
    """Remove the backfilled initial version records."""
    conn = op.get_bind()

    # Delete only records created by this migration
    # Identified by: auth_type='dev' (never used in production), version=1, action='create'
    result = conn.execute(sa.text("""
        DELETE FROM content_history
        WHERE auth_type = 'dev'
          AND version = 1
          AND action = 'create'
    """))

    print(f"Deleted {result.rowcount} backfilled version records")
