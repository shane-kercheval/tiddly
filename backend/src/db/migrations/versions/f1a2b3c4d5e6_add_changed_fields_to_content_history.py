"""add changed_fields to content_history

Revision ID: f1a2b3c4d5e6
Revises: 261e9a509112
Create Date: 2026-02-13

"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = '261e9a509112'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'content_history',
        sa.Column('changed_fields', postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('content_history', 'changed_fields')
