"""history action refactor

Revision ID: 49e5c8cf6af4
Revises: 4de36882c73d
Create Date: 2026-02-08 09:36:45.111902

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '49e5c8cf6af4'
down_revision: Union[str, Sequence[str], None] = '4de36882c73d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Rename old RESTORE action to UNDELETE (frees up 'restore' for version restoration)
    op.execute("UPDATE content_history SET action = 'undelete' WHERE action = 'restore'")
    # Make version column nullable (audit events have NULL version)
    op.alter_column('content_history', 'version',
               existing_type=sa.INTEGER(),
               nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    # Rename UNDELETE back to RESTORE
    op.execute("UPDATE content_history SET action = 'restore' WHERE action = 'undelete'")
    # Delete audit rows (NULL version) — they only exist post-upgrade and have no
    # representation in the old schema. Setting them all to version=0 would violate
    # the unique constraint on (user_id, entity_type, entity_id, version).
    op.execute("DELETE FROM content_history WHERE version IS NULL")
    op.alter_column('content_history', 'version',
               existing_type=sa.INTEGER(),
               nullable=False)
