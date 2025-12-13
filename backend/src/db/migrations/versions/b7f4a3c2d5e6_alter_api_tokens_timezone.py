"""
Alter api_tokens datetime columns to use timezone.

Changes last_used_at and expires_at from TIMESTAMP to TIMESTAMPTZ
for proper timezone-aware datetime handling.

Revision ID: b7f4a3c2d5e6
Revises: a5e3f2b9c1d4
Create Date: 2025-12-13 12:00:00.000000
"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7f4a3c2d5e6"
down_revision: str | Sequence[str] | None = "a5e3f2b9c1d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema - change columns to TIMESTAMPTZ."""
    op.execute(
        "ALTER TABLE api_tokens "
        "ALTER COLUMN last_used_at TYPE TIMESTAMP WITH TIME ZONE",
    )
    op.execute(
        "ALTER TABLE api_tokens "
        "ALTER COLUMN expires_at TYPE TIMESTAMP WITH TIME ZONE",
    )


def downgrade() -> None:
    """Downgrade schema - revert to TIMESTAMP without timezone."""
    op.execute(
        "ALTER TABLE api_tokens "
        "ALTER COLUMN last_used_at TYPE TIMESTAMP WITHOUT TIME ZONE",
    )
    op.execute(
        "ALTER TABLE api_tokens "
        "ALTER COLUMN expires_at TYPE TIMESTAMP WITHOUT TIME ZONE",
    )
