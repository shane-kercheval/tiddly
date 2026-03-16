"""migrate users to pro tier for beta

Revision ID: 37924b35a9a8
Revises: 2c2ffb6307ce
Create Date: 2026-03-15 13:22:59.738635

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '37924b35a9a8'
down_revision: Union[str, Sequence[str], None] = '2c2ffb6307ce'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Migrate all users to Pro tier for beta and update column default."""
    # Data migration: set all non-pro users to pro
    op.execute("UPDATE users SET tier = 'pro' WHERE tier IS DISTINCT FROM 'pro'")

    # Update server_default from 'free' to 'pro' so new signups get Pro during beta
    op.alter_column(
        'users', 'tier',
        existing_type=sa.VARCHAR(length=50),
        server_default=sa.text("'pro'"),
        existing_nullable=False,
        comment="User subscription tier (e.g., 'free', 'standard', 'pro')",
        existing_comment="User subscription tier (e.g., 'free', 'pro')",
    )


def downgrade() -> None:
    """No-op. This migration is effectively one-way.

    When beta ends, a separate migration will handle downgrading non-paying
    users. A naive revert would clobber any users legitimately assigned Pro.
    """
    pass
