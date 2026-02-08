"""Remove diff_type column and update snapshot index

Revision ID: 7b2e0552ad5f
Revises: 49e5c8cf6af4
Create Date: 2026-02-08 15:33:08.752852

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7b2e0552ad5f'
down_revision: Union[str, Sequence[str], None] = '49e5c8cf6af4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Drop the old partial index that references diff_type
    op.drop_index('ix_content_history_snapshots', table_name='content_history')
    # Drop the diff_type column
    op.drop_column('content_history', 'diff_type')
    # Create new partial index using content_snapshot IS NOT NULL
    op.create_index(
        'ix_content_history_snapshots',
        'content_history',
        ['user_id', 'entity_type', 'entity_id', 'version'],
        postgresql_where=sa.text('content_snapshot IS NOT NULL'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_content_history_snapshots', table_name='content_history')
    op.add_column('content_history', sa.Column('diff_type', sa.VARCHAR(length=20), autoincrement=False, nullable=False))
    op.create_index(
        'ix_content_history_snapshots',
        'content_history',
        ['user_id', 'entity_type', 'entity_id', 'version'],
        postgresql_where=sa.text("diff_type = 'snapshot'"),
    )
