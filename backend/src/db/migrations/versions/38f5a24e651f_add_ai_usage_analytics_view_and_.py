"""add ai_usage_analytics view and pgcrypto extension

Revision ID: 38f5a24e651f
Revises: 0f315127925c
Create Date: 2026-04-16 17:48:26.548376

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '38f5a24e651f'
down_revision: Union[str, Sequence[str], None] = '0f315127925c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # pgcrypto provides digest() for SHA-256 user_id pseudonymization in the view.
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute(
        """
        CREATE VIEW ai_usage_analytics AS
        SELECT
            id,
            bucket_start,
            encode(digest(user_id::text, 'sha256'), 'hex') AS user_hash,
            use_case,
            model,
            key_source,
            request_count,
            total_cost
        FROM ai_usage
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP VIEW IF EXISTS ai_usage_analytics")
    # pgcrypto is intentionally NOT dropped — other objects may depend on it.
