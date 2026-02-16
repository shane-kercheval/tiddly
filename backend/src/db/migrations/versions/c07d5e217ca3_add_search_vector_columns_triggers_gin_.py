"""add_search_vector_columns_triggers_gin_indexes

Revision ID: c07d5e217ca3
Revises: 1b278625065d
Create Date: 2026-02-15 18:09:28.151282

Adds tsvector columns, backfills existing data, creates trigger functions/triggers
for automatic maintenance, and GIN indexes for full-text search.

Order matters:
  1. Add search_vector columns
  2. Backfill existing rows (before triggers exist — triggers' IS DISTINCT FROM
     guard would skip no-op updates, making post-trigger backfill impossible)
  3. Create trigger functions + triggers
  4. Create GIN indexes

Search field weights match the Python-side ILIKE scoring config (Milestone 3):
  - Bookmarks: title=A, description=B, summary=B, content=C
  - Notes: title=A, description=B, content=C
  - Prompts: name=A, title=A, description=B, content=C
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c07d5e217ca3'
down_revision: Union[str, Sequence[str], None] = '1b278625065d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. Add search_vector columns
    op.add_column('bookmarks', sa.Column('search_vector', postgresql.TSVECTOR(), nullable=True))
    op.add_column('notes', sa.Column('search_vector', postgresql.TSVECTOR(), nullable=True))
    op.add_column('prompts', sa.Column('search_vector', postgresql.TSVECTOR(), nullable=True))

    # 2. Backfill existing data (must happen BEFORE triggers are created)
    op.execute("""
        UPDATE bookmarks SET search_vector =
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(content, '')), 'C')
    """)

    op.execute("""
        UPDATE notes SET search_vector =
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(content, '')), 'C')
    """)

    op.execute("""
        UPDATE prompts SET search_vector =
            setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(content, '')), 'C')
    """)

    # 3. Create trigger functions and triggers
    # Triggers only recompute tsvector when searchable content fields change
    # (not on last_used_at, archive, or soft-delete updates)

    # -- Bookmark trigger --
    op.execute("""
        CREATE FUNCTION bookmarks_search_vector_update() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'INSERT' OR
               OLD.title IS DISTINCT FROM NEW.title OR
               OLD.description IS DISTINCT FROM NEW.description OR
               OLD.summary IS DISTINCT FROM NEW.summary OR
               OLD.content IS DISTINCT FROM NEW.content THEN
                NEW.search_vector :=
                    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
                    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
                    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'C');
            ELSE
                NEW.search_vector := OLD.search_vector;
            END IF;
            RETURN NEW;
        END
        $$ LANGUAGE plpgsql
    """)

    op.execute("""
        CREATE TRIGGER bookmarks_search_vector_trigger
            BEFORE INSERT OR UPDATE ON bookmarks
            FOR EACH ROW EXECUTE FUNCTION bookmarks_search_vector_update()
    """)

    # -- Note trigger --
    op.execute("""
        CREATE FUNCTION notes_search_vector_update() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'INSERT' OR
               OLD.title IS DISTINCT FROM NEW.title OR
               OLD.description IS DISTINCT FROM NEW.description OR
               OLD.content IS DISTINCT FROM NEW.content THEN
                NEW.search_vector :=
                    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
                    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'C');
            ELSE
                NEW.search_vector := OLD.search_vector;
            END IF;
            RETURN NEW;
        END
        $$ LANGUAGE plpgsql
    """)

    op.execute("""
        CREATE TRIGGER notes_search_vector_trigger
            BEFORE INSERT OR UPDATE ON notes
            FOR EACH ROW EXECUTE FUNCTION notes_search_vector_update()
    """)

    # -- Prompt trigger --
    op.execute("""
        CREATE FUNCTION prompts_search_vector_update() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'INSERT' OR
               OLD.name IS DISTINCT FROM NEW.name OR
               OLD.title IS DISTINCT FROM NEW.title OR
               OLD.description IS DISTINCT FROM NEW.description OR
               OLD.content IS DISTINCT FROM NEW.content THEN
                NEW.search_vector :=
                    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
                    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'C');
            ELSE
                NEW.search_vector := OLD.search_vector;
            END IF;
            RETURN NEW;
        END
        $$ LANGUAGE plpgsql
    """)

    op.execute("""
        CREATE TRIGGER prompts_search_vector_trigger
            BEFORE INSERT OR UPDATE ON prompts
            FOR EACH ROW EXECUTE FUNCTION prompts_search_vector_update()
    """)

    # 4. Create GIN indexes
    # Standard CREATE INDEX (not CONCURRENTLY) — at current scale the brief lock
    # is acceptable. Consider CONCURRENTLY if tables grow to tens of thousands of rows.
    op.create_index(
        'ix_bookmarks_search_vector', 'bookmarks', ['search_vector'],
        postgresql_using='gin',
    )
    op.create_index(
        'ix_notes_search_vector', 'notes', ['search_vector'],
        postgresql_using='gin',
    )
    op.create_index(
        'ix_prompts_search_vector', 'prompts', ['search_vector'],
        postgresql_using='gin',
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Drop GIN indexes
    op.drop_index('ix_prompts_search_vector', table_name='prompts')
    op.drop_index('ix_notes_search_vector', table_name='notes')
    op.drop_index('ix_bookmarks_search_vector', table_name='bookmarks')

    # Drop triggers
    op.execute('DROP TRIGGER IF EXISTS prompts_search_vector_trigger ON prompts')
    op.execute('DROP TRIGGER IF EXISTS notes_search_vector_trigger ON notes')
    op.execute('DROP TRIGGER IF EXISTS bookmarks_search_vector_trigger ON bookmarks')

    # Drop trigger functions
    op.execute('DROP FUNCTION IF EXISTS prompts_search_vector_update()')
    op.execute('DROP FUNCTION IF EXISTS notes_search_vector_update()')
    op.execute('DROP FUNCTION IF EXISTS bookmarks_search_vector_update()')

    # Drop columns
    op.drop_column('prompts', 'search_vector')
    op.drop_column('notes', 'search_vector')
    op.drop_column('bookmarks', 'search_vector')
