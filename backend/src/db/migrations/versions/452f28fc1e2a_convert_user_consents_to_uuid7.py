"""convert_user_consents_to_uuid7

This migration was missed from the main UUID7 migration.
Converts user_consents.id from integer to UUID7.

Revision ID: 452f28fc1e2a
Revises: 06bc6e1a1945
Create Date: 2026-01-07 09:33:56.431512

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from uuid6 import uuid7


# revision identifiers, used by Alembic.
revision: str = '452f28fc1e2a'
down_revision: Union[str, Sequence[str], None] = '06bc6e1a1945'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def get_pk_constraint_name(connection, table_name: str) -> str | None:
    """Query actual primary key constraint name from database."""
    result = connection.execute(sa.text("""
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name = :table AND constraint_type = 'PRIMARY KEY'
    """), {"table": table_name})
    return result.scalar()


def upgrade() -> None:
    """Upgrade schema: convert user_consents.id from integer to UUID7."""
    connection = op.get_bind()

    # Phase 1: Add new_id column
    op.add_column('user_consents', sa.Column('new_id', PG_UUID(as_uuid=True), nullable=True))

    # Phase 2: Generate UUIDs for existing rows
    rows = connection.execute(sa.text("SELECT id FROM user_consents"))
    for row in rows:
        new_uuid = str(uuid7())
        connection.execute(
            sa.text("UPDATE user_consents SET new_id = :new_id WHERE id = :old_id"),
            {"new_id": new_uuid, "old_id": row.id},
        )

    # Make new_id non-nullable
    op.alter_column('user_consents', 'new_id', nullable=False)

    # Phase 3: Drop old PK constraint
    pk_name = get_pk_constraint_name(connection, 'user_consents')
    if pk_name:
        op.drop_constraint(pk_name, 'user_consents', type_='primary')

    # Phase 4: Drop old id column and rename new_id
    op.drop_column('user_consents', 'id')
    op.alter_column('user_consents', 'new_id', new_column_name='id')

    # Phase 5: Recreate PK constraint
    op.create_primary_key('user_consents_pkey', 'user_consents', ['id'])


def downgrade() -> None:
    """Downgrade schema."""
    raise NotImplementedError(
        "Downgrade not supported for PK type change. Restore from backup.",
    )
