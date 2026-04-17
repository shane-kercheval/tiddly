"""add ai_usage table

Revision ID: 0f315127925c
Revises: 37924b35a9a8
Create Date: 2026-04-06 14:50:14.567914

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '0f315127925c'
down_revision: Union[str, Sequence[str], None] = '37924b35a9a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'ai_usage',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('bucket_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('use_case', sa.String(), nullable=False),
        sa.Column('model', sa.String(), nullable=False),
        sa.Column('key_source', sa.String(), nullable=False),
        sa.Column('request_count', sa.Integer(), nullable=False),
        sa.Column('total_cost', sa.Numeric(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'bucket_start', 'user_id', 'use_case', 'model', 'key_source',
            name='uq_ai_usage_bucket',
        ),
    )
    op.create_index(
        'ix_ai_usage_user_bucket', 'ai_usage', ['user_id', 'bucket_start'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_ai_usage_user_bucket', table_name='ai_usage')
    op.drop_table('ai_usage')
