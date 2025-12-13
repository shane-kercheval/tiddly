"""
add_summary_to_bookmarks.

Revision ID: 62fe0762a928
Revises: b7f4a3c2d5e6
Create Date: 2025-12-13 10:58:32.532275
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '62fe0762a928'
down_revision: str | Sequence[str] | None = 'b7f4a3c2d5e6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add summary column to bookmarks for AI-generated summaries (Phase 2)."""
    op.add_column("bookmarks", sa.Column("summary", sa.Text(), nullable=True))


def downgrade() -> None:
    """Remove summary column from bookmarks."""
    op.drop_column("bookmarks", "summary")
