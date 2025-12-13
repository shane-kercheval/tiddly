"""
Add api_tokens table.

Revision ID: a5e3f2b9c1d4
Revises: 1421729fa883
Create Date: 2025-12-10 22:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a5e3f2b9c1d4"
down_revision: str | Sequence[str] | None = "1421729fa883"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "name",
            sa.String(length=100),
            nullable=False,
            comment="User-provided name, e.g., 'CLI', 'MCP Server'",
        ),
        sa.Column(
            "token_hash",
            sa.String(length=64),
            nullable=False,
            comment="SHA-256 hash of the token",
        ),
        sa.Column(
            "token_prefix",
            sa.String(length=12),
            nullable=False,
            comment="First 12 chars for identification, e.g., 'bm_abc12345'",
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="Optional expiration date",
        ),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_api_tokens_user_id"), "api_tokens", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_api_tokens_token_hash"), "api_tokens", ["token_hash"], unique=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_api_tokens_token_hash"), table_name="api_tokens")
    op.drop_index(op.f("ix_api_tokens_user_id"), table_name="api_tokens")
    op.drop_table("api_tokens")
