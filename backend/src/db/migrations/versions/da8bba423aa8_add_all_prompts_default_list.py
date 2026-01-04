"""add all prompts default list

Revision ID: da8bba423aa8
Revises: c3057bc6a3a9
Create Date: 2026-01-03 19:44:21.087859

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'da8bba423aa8'
down_revision: Union[str, Sequence[str], None] = 'c3057bc6a3a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add 'All Prompts' default list for existing users."""
    connection = op.get_bind()

    content_lists = sa.table(
        "content_lists",
        sa.column("user_id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("content_types", postgresql.JSONB),
        sa.column("filter_expression", postgresql.JSONB),
        sa.column("default_sort_by", sa.String),
        sa.column("default_sort_ascending", sa.Boolean),
    )

    user_ids = connection.execute(sa.text("select id from users")).scalars().all()
    if not user_ids:
        return

    definition = {"name": "All Prompts", "content_types": ["prompt"]}
    filter_expression = {"groups": [], "group_operator": "OR"}

    existing_rows = connection.execute(
        sa.select(content_lists.c.user_id).where(
            content_lists.c.name == definition["name"],
        ),
    ).all()
    existing_user_ids = {row.user_id for row in existing_rows}

    inserts: list[dict] = []
    for user_id in user_ids:
        if user_id in existing_user_ids:
            continue
        inserts.append(
            {
                "user_id": user_id,
                "name": definition["name"],
                "content_types": definition["content_types"],
                "filter_expression": filter_expression,
                "default_sort_by": "last_used_at",
                "default_sort_ascending": False,
            }
        )

    if inserts:
        op.bulk_insert(content_lists, inserts)


def downgrade() -> None:
    """Remove 'All Prompts' default list."""
    connection = op.get_bind()

    content_lists = sa.table(
        "content_lists",
        sa.column("name", sa.String),
        sa.column("content_types", postgresql.JSONB),
        sa.column("filter_expression", postgresql.JSONB),
        sa.column("default_sort_by", sa.String),
        sa.column("default_sort_ascending", sa.Boolean),
    )

    definition = {"name": "All Prompts", "content_types": ["prompt"]}
    filter_expression = {"groups": [], "group_operator": "OR"}

    delete_stmt = sa.delete(content_lists).where(
        content_lists.c.name == definition["name"],
        content_lists.c.content_types == definition["content_types"],
        content_lists.c.filter_expression == filter_expression,
        content_lists.c.default_sort_by == "last_used_at",
        content_lists.c.default_sort_ascending.is_(False),
    )
    connection.execute(delete_stmt)
