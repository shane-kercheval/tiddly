"""Convert all content tables to UUID7 primary keys.

Tables converted:
- bookmarks, notes, prompts, content_lists, tags, api_tokens, note_versions

Junction tables updated:
- bookmark_tags (bookmark_id, tag_id)
- note_tags (note_id, tag_id)
- prompt_tags (prompt_id, tag_id)

Other updates:
- note_versions.note_id FK
- user_settings.sidebar_order JSONB (list IDs)

Cleanup:
- Drop deprecated tab_order column from user_settings

Revision ID: 9e7d4c4a8c2a
Revises: da8bba423aa8
Create Date: 2026-01-06 23:27:58.405158
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from uuid6 import uuid7

# revision identifiers, used by Alembic.
revision: str = '9e7d4c4a8c2a'
down_revision: Union[str, Sequence[str], None] = 'da8bba423aa8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# =============================================================================
# Configuration
# =============================================================================

# Entity tables with their PKs to convert
ENTITY_TABLES = ['bookmarks', 'notes', 'prompts', 'content_lists', 'tags', 'api_tokens', 'note_versions']

# Junction tables: {table: [(fk_column, referenced_table), ...]}
JUNCTION_TABLES = {
    'bookmark_tags': [('bookmark_id', 'bookmarks'), ('tag_id', 'tags')],
    'note_tags': [('note_id', 'notes'), ('tag_id', 'tags')],
    'prompt_tags': [('prompt_id', 'prompts'), ('tag_id', 'tags')],
}

# Other FK relationships: [(table, fk_column, referenced_table), ...]
OTHER_FKS = [
    ('note_versions', 'note_id', 'notes'),
]

# Global ID mappings for JSONB updates: {table_name: {old_int_id: new_uuid_str}}
ID_MAPPINGS: dict[str, dict[int, str]] = {}


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
    """Query all index names for a table (excluding PK/unique constraint indexes)."""
    result = connection.execute(sa.text("""
        SELECT indexname FROM pg_indexes
        WHERE tablename = :table
          AND indexname NOT IN (
              SELECT constraint_name FROM information_schema.table_constraints
              WHERE table_name = :table
          )
    """), {"table": table_name})
    return [row[0] for row in result]


# =============================================================================
# Phase Functions
# =============================================================================

def phase1_add_new_columns(connection) -> None:
    """Phase 1: Add new_id columns to all entity tables and new FK columns to junction/dependent tables."""

    # Add new_id to all entity tables
    for table in ENTITY_TABLES:
        op.add_column(table, sa.Column('new_id', PG_UUID(as_uuid=True), nullable=True))

    # Add new FK columns to junction tables
    for junction_table, fk_columns in JUNCTION_TABLES.items():
        for fk_col, _ in fk_columns:
            op.add_column(junction_table, sa.Column(f'new_{fk_col}', PG_UUID(as_uuid=True), nullable=True))

    # Add new FK columns to other dependent tables
    for dep_table, fk_col, _ in OTHER_FKS:
        op.add_column(dep_table, sa.Column(f'new_{fk_col}', PG_UUID(as_uuid=True), nullable=True))


def phase2_populate_new_columns(connection) -> None:
    """Phase 2: Generate UUIDs for entity tables and populate FK references."""

    # Generate UUIDs for all entity tables
    for table in ENTITY_TABLES:
        # Store mapping for content_lists (needed for JSONB update)
        store_mapping = (table == 'content_lists')
        if store_mapping:
            ID_MAPPINGS[table] = {}

        rows = connection.execute(sa.text(f"SELECT id FROM {table}"))  # noqa: S608
        for row in rows:
            new_uuid = str(uuid7())
            if store_mapping:
                ID_MAPPINGS[table][row.id] = new_uuid
            connection.execute(
                sa.text(f"UPDATE {table} SET new_id = :new_id WHERE id = :old_id"),  # noqa: S608
                {"new_id": new_uuid, "old_id": row.id},
            )

        # Make new_id non-nullable
        op.alter_column(table, 'new_id', nullable=False)

    # Populate junction table FK columns using JOINs
    for junction_table, fk_columns in JUNCTION_TABLES.items():
        for fk_col, ref_table in fk_columns:
            connection.execute(sa.text(f"""
                UPDATE {junction_table} jt
                SET new_{fk_col} = t.new_id
                FROM {ref_table} t
                WHERE jt.{fk_col} = t.id
            """))  # noqa: S608

    # Populate other dependent table FK columns
    for dep_table, fk_col, ref_table in OTHER_FKS:
        connection.execute(sa.text(f"""
            UPDATE {dep_table} d
            SET new_{fk_col} = t.new_id
            FROM {ref_table} t
            WHERE d.{fk_col} = t.id
        """))  # noqa: S608


def phase3_drop_old_constraints(connection) -> None:
    """Phase 3: Drop all old constraints (FKs, PKs, indexes)."""

    # Drop FK constraints from junction tables
    for junction_table, fk_columns in JUNCTION_TABLES.items():
        for fk_col, _ in fk_columns:
            fk_name = get_fk_constraint_name(connection, junction_table, fk_col)
            if fk_name:
                op.drop_constraint(fk_name, junction_table, type_='foreignkey')

    # Drop FK constraints from other dependent tables
    for dep_table, fk_col, _ in OTHER_FKS:
        fk_name = get_fk_constraint_name(connection, dep_table, fk_col)
        if fk_name:
            op.drop_constraint(fk_name, dep_table, type_='foreignkey')

    # Drop composite PKs from junction tables
    for junction_table in JUNCTION_TABLES:
        pk_name = get_pk_constraint_name(connection, junction_table)
        if pk_name:
            op.drop_constraint(pk_name, junction_table, type_='primary')

    # Drop PKs from entity tables
    for table in ENTITY_TABLES:
        pk_name = get_pk_constraint_name(connection, table)
        if pk_name:
            op.drop_constraint(pk_name, table, type_='primary')

    # Drop indexes that will be affected (recreated in phase 5)
    # Note: Some indexes are auto-dropped with constraints, but we explicitly handle others
    indexes_to_drop = [
        ('bookmark_tags', 'ix_bookmark_tags_tag_id'),
        ('note_tags', 'ix_note_tags_tag_id'),
        ('prompt_tags', 'ix_prompt_tags_tag_id'),
        ('note_versions', 'ix_note_versions_note_id_version'),
        ('bookmarks', 'uq_bookmark_user_url_active'),
        ('prompts', 'uq_prompt_user_name_active'),
    ]
    for table, index_name in indexes_to_drop:
        existing_indexes = get_index_names(connection, table)
        if index_name in existing_indexes:
            op.drop_index(index_name, table_name=table)


def phase4_swap_columns(connection) -> None:
    """Phase 4: Drop old columns and rename new columns."""

    # Drop old FK columns from junction tables and rename new ones
    for junction_table, fk_columns in JUNCTION_TABLES.items():
        for fk_col, _ in fk_columns:
            op.drop_column(junction_table, fk_col)
            op.alter_column(junction_table, f'new_{fk_col}', new_column_name=fk_col)

    # Drop old FK columns from other dependent tables and rename new ones
    for dep_table, fk_col, _ in OTHER_FKS:
        op.drop_column(dep_table, fk_col)
        op.alter_column(dep_table, f'new_{fk_col}', new_column_name=fk_col)

    # Drop old id columns from entity tables and rename new ones
    for table in ENTITY_TABLES:
        op.drop_column(table, 'id')
        op.alter_column(table, 'new_id', new_column_name='id')


def phase5_recreate_constraints(connection) -> None:
    """Phase 5: Recreate all constraints with proper names."""

    # Recreate PKs on entity tables
    for table in ENTITY_TABLES:
        op.create_primary_key(f'{table}_pkey', table, ['id'])

    # Recreate composite PKs on junction tables
    for junction_table, fk_columns in JUNCTION_TABLES.items():
        pk_cols = [fk_col for fk_col, _ in fk_columns]
        op.create_primary_key(f'{junction_table}_pkey', junction_table, pk_cols)

    # Recreate FK constraints on junction tables
    for junction_table, fk_columns in JUNCTION_TABLES.items():
        for fk_col, ref_table in fk_columns:
            op.create_foreign_key(
                f'{junction_table}_{fk_col}_fkey',
                junction_table, ref_table,
                [fk_col], ['id'],
                ondelete='CASCADE',
            )

    # Recreate FK constraints on other dependent tables
    for dep_table, fk_col, ref_table in OTHER_FKS:
        op.create_foreign_key(
            f'{dep_table}_{fk_col}_fkey',
            dep_table, ref_table,
            [fk_col], ['id'],
            ondelete='CASCADE',
        )

    # Recreate indexes
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

    # Junction table indexes for tag_id lookups
    op.create_index('ix_bookmark_tags_tag_id', 'bookmark_tags', ['tag_id'])
    op.create_index('ix_note_tags_tag_id', 'note_tags', ['tag_id'])
    op.create_index('ix_prompt_tags_tag_id', 'prompt_tags', ['tag_id'])

    # note_versions composite index
    op.create_index('ix_note_versions_note_id_version', 'note_versions', ['note_id', 'version'])


def migrate_sidebar_order_jsonb(connection) -> None:
    """Update user_settings.sidebar_order JSONB to use new content_list UUIDs."""
    list_id_mapping = ID_MAPPINGS.get('content_lists', {})

    if not list_id_mapping:
        return  # No content_lists to migrate

    rows = connection.execute(sa.text(
        "SELECT user_id, sidebar_order FROM user_settings WHERE sidebar_order IS NOT NULL",
    ))

    for row in rows:
        sidebar_order = row.sidebar_order
        if not sidebar_order or 'items' not in sidebar_order:
            continue

        def update_items(items_list: list) -> bool:
            """Recursively update list IDs in items (handles groups with nested items)."""
            changed = False
            for item in items_list:
                if item.get('type') == 'list' and isinstance(item.get('id'), int):
                    old_id = item['id']
                    if old_id in list_id_mapping:
                        item['id'] = list_id_mapping[old_id]
                        changed = True
                elif item.get('type') == 'group' and 'items' in item:
                    if update_items(item['items']):
                        changed = True
            return changed

        if update_items(sidebar_order.get('items', [])):
            connection.execute(
                sa.text("UPDATE user_settings SET sidebar_order = :new_order WHERE user_id = :user_id"),
                {"new_order": json.dumps(sidebar_order), "user_id": row.user_id},
            )


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

    # Update JSONB fields that store entity IDs
    migrate_sidebar_order_jsonb(connection)

    # Cleanup: Drop deprecated tab_order column
    op.drop_column('user_settings', 'tab_order')


def downgrade() -> None:
    """Downgrade schema."""
    raise NotImplementedError(
        "Downgrade not supported for PK type change. Restore from backup.",
    )
