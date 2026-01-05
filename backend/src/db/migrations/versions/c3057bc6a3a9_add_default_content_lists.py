"""add_default_content_lists

Revision ID: c3057bc6a3a9
Revises: 8778dc234eac
Create Date: 2026-01-03 14:14:55.591282

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c3057bc6a3a9'
down_revision: Union[str, Sequence[str], None] = '8778dc234eac'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
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

    default_definitions = [
        {"name": "All Bookmarks", "content_types": ["bookmark"]},
        {"name": "All Notes", "content_types": ["note"]},
    ]
    default_names = [definition["name"] for definition in default_definitions]
    filter_expression = {"groups": [], "group_operator": "OR"}

    existing_rows = connection.execute(
        sa.select(content_lists.c.user_id, content_lists.c.name).where(
            content_lists.c.name.in_(default_names),
        ),
    ).all()
    existing = {(row.user_id, row.name) for row in existing_rows}

    inserts: list[dict] = []
    for user_id in user_ids:
        for definition in default_definitions:
            key = (user_id, definition["name"])
            if key in existing:
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
    """Downgrade schema."""
    connection = op.get_bind()

    content_lists = sa.table(
        "content_lists",
        sa.column("name", sa.String),
        sa.column("content_types", postgresql.JSONB),
        sa.column("filter_expression", postgresql.JSONB),
        sa.column("default_sort_by", sa.String),
        sa.column("default_sort_ascending", sa.Boolean),
    )

    default_definitions = [
        {"name": "All Bookmarks", "content_types": ["bookmark"]},
        {"name": "All Notes", "content_types": ["note"]},
    ]
    filter_expression = {"groups": [], "group_operator": "OR"}

    for definition in default_definitions:
        delete_stmt = sa.delete(content_lists).where(
            content_lists.c.name == definition["name"],
            content_lists.c.content_types == definition["content_types"],
            content_lists.c.filter_expression == filter_expression,
            content_lists.c.default_sort_by == "last_used_at",
            content_lists.c.default_sort_ascending.is_(False),
        )
        connection.execute(delete_stmt)
