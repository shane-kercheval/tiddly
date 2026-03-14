"""add email_verified to users

Revision ID: 2c2ffb6307ce
Revises: c07d5e217ca3
Create Date: 2026-03-13 16:46:58.324184

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = '2c2ffb6307ce'
down_revision: Union[str, Sequence[str], None] = 'c07d5e217ca3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('email_verified', sa.Boolean(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'email_verified')
