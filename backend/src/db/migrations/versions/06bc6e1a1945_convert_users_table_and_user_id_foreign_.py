"""Convert users table and user_id foreign keys to UUID7.

This is a follow-up migration to convert the users table and all user_id
foreign key columns to UUID7, completing the migration started in the
previous revision.

Tables modified:
- users: id column converted to UUID7

Foreign key columns converted (all reference users.id):
- bookmarks.user_id
- notes.user_id
- prompts.user_id
- content_lists.user_id
- tags.user_id
- api_tokens.user_id
- user_settings.user_id (also primary key)
- user_consents.user_id

Indexes dropped and recreated:
- uq_tags_user_id_name
- ix_user_consents_user_id
- uq_bookmark_user_url_active
- uq_prompt_user_name_active
- user_settings_pkey

Revision ID: 06bc6e1a1945
Revises: 9e7d4c4a8c2a
Create Date: 2026-01-06 23:47:14.333741
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from uuid6 import uuid7

# revision identifiers, used by Alembic.
revision: str = '06bc6e1a1945'
down_revision: Union[str, Sequence[str], None] = '9e7d4c4a8c2a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# =============================================================================
# Configuration
# =============================================================================

# Tables with user_id FK columns to convert
TABLES_WITH_USER_ID = [
    'bookmarks',
    'notes',
    'prompts',
    'content_lists',
    'tags',
    'api_tokens',
    'user_settings',
    'user_consents',
]


# =============================================================================
# Helper Functions
# =============================================================================

def get_pk_constraint_name(connection, table_name: str) -> str | None:
    """Query actual primary key constraint name from database."""
    result = connection.execute(sa.text("""
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name = :table AND constraint_type = 'PRIMARY KEY'
    """), {"table": table_name})
    return result.scalar()


def get_fk_constraint_name(connection, table_name: str, column_name: str) -> str | None:
    """Query actual foreign key constraint name from database."""
    result = connection.execute(sa.text("""
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.table_name = :table
            AND tc.constraint_type = 'FOREIGN KEY'
            AND kcu.column_name = :column
    """), {"table": table_name, "column": column_name})
    return result.scalar()


def get_index_names(connection, table_name: str) -> list[str]:
    """Query all index names for a table."""
    result = connection.execute(sa.text("""
        SELECT indexname FROM pg_indexes
        WHERE tablename = :table
    """), {"table": table_name})
    return [row[0] for row in result]


# =============================================================================
# Phase Functions
# =============================================================================

def phase1_add_new_columns(connection) -> None:
    """Phase 1: Add new UUID columns."""
    # Add new_id to users table
    op.add_column('users', sa.Column('new_id', PG_UUID(as_uuid=True), nullable=True))

    # Add new_user_id to all tables with user_id FK
    for table in TABLES_WITH_USER_ID:
        op.add_column(table, sa.Column('new_user_id', PG_UUID(as_uuid=True), nullable=True))


def phase2_populate_new_columns(connection) -> None:
    """Phase 2: Generate UUIDs and populate FK references."""
    # Generate UUIDs for users table
    rows = connection.execute(sa.text("SELECT id FROM users"))
    for row in rows:
        new_uuid = str(uuid7())
        connection.execute(
            sa.text("UPDATE users SET new_id = :new_id WHERE id = :old_id"),
            {"new_id": new_uuid, "old_id": row.id},
        )

    # Make users.new_id non-nullable
    op.alter_column('users', 'new_id', nullable=False)

    # Populate new_user_id in all dependent tables by joining to users
    for table in TABLES_WITH_USER_ID:
        connection.execute(sa.text(f"""
            UPDATE {table} t
            SET new_user_id = u.new_id
            FROM users u
            WHERE t.user_id = u.id
        """))  # noqa: S608

        # Make new_user_id non-nullable
        op.alter_column(table, 'new_user_id', nullable=False)


def phase3_drop_old_constraints(connection) -> None:
    """Phase 3: Drop all old constraints and indexes."""
    # Drop FK constraints from all tables with user_id
    for table in TABLES_WITH_USER_ID:
        fk_name = get_fk_constraint_name(connection, table, 'user_id')
        if fk_name:
            op.drop_constraint(fk_name, table, type_='foreignkey')

    # Drop PK from user_settings (user_id is the PK there)
    pk_name = get_pk_constraint_name(connection, 'user_settings')
    if pk_name:
        op.drop_constraint(pk_name, 'user_settings', type_='primary')

    # Drop PK from users
    pk_name = get_pk_constraint_name(connection, 'users')
    if pk_name:
        op.drop_constraint(pk_name, 'users', type_='primary')

    # Drop unique constraint on tags (user_id, name) - it's a constraint, not just an index
    op.drop_constraint('uq_tags_user_id_name', 'tags', type_='unique')

    # Drop indexes that involve user_id
    indexes_to_drop = [
        ('user_consents', 'ix_user_consents_user_id'),
        ('bookmarks', 'uq_bookmark_user_url_active'),
        ('prompts', 'uq_prompt_user_name_active'),
    ]
    for table, index_name in indexes_to_drop:
        existing_indexes = get_index_names(connection, table)
        if index_name in existing_indexes:
            op.drop_index(index_name, table_name=table)


def phase4_swap_columns(connection) -> None:
    """Phase 4: Drop old columns and rename new columns."""
    # Drop old user_id columns and rename new ones
    for table in TABLES_WITH_USER_ID:
        op.drop_column(table, 'user_id')
        op.alter_column(table, 'new_user_id', new_column_name='user_id')

    # Drop old id column from users and rename new one
    op.drop_column('users', 'id')
    op.alter_column('users', 'new_id', new_column_name='id')


def phase5_recreate_constraints(connection) -> None:
    """Phase 5: Recreate all constraints and indexes."""
    # Recreate PK on users
    op.create_primary_key('users_pkey', 'users', ['id'])

    # Recreate PK on user_settings (user_id is the PK)
    op.create_primary_key('user_settings_pkey', 'user_settings', ['user_id'])

    # Recreate FK constraints on all tables with user_id
    for table in TABLES_WITH_USER_ID:
        op.create_foreign_key(
            f'{table}_user_id_fkey',
            table, 'users',
            ['user_id'], ['id'],
            ondelete='CASCADE',
        )

    # Recreate indexes
    # Unique index on tags (user_id, name)
    op.create_unique_constraint('uq_tags_user_id_name', 'tags', ['user_id', 'name'])

    # Unique index on user_consents.user_id
    op.create_index('ix_user_consents_user_id', 'user_consents', ['user_id'], unique=True)

    # Partial unique index on bookmarks (user_id + url for non-deleted)
    op.create_index(
        'uq_bookmark_user_url_active', 'bookmarks',
        ['user_id', 'url'], unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # Partial unique index on prompts (user_id + name for non-deleted)
    op.create_index(
        'uq_prompt_user_name_active', 'prompts',
        ['user_id', 'name'], unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # Add index on user_id columns for query performance
    for table in ['bookmarks', 'notes', 'prompts', 'content_lists', 'tags', 'api_tokens']:
        op.create_index(f'ix_{table}_user_id', table, ['user_id'])


# =============================================================================
# Migration Entry Points
# =============================================================================

def upgrade() -> None:
    """Upgrade schema."""
    connection = op.get_bind()

    # Phase 1: Add new columns
    phase1_add_new_columns(connection)

    # Phase 2: Populate new columns with UUIDs and FK references
    phase2_populate_new_columns(connection)

    # Phase 3: Drop all old constraints
    phase3_drop_old_constraints(connection)

    # Phase 4: Drop old columns, rename new columns
    phase4_swap_columns(connection)

    # Phase 5: Recreate all constraints
    phase5_recreate_constraints(connection)


def downgrade() -> None:
    """Downgrade schema."""
    raise NotImplementedError(
        "Downgrade not supported for PK type change. Restore from backup.",
    )
