"""normalize_filter_expression_to_filter_groups_and_filter_group_tags

Revision ID: f1a2b3c4d5e6
Revises: 818b82bc0638
Create Date: 2026-01-25 10:00:00.000000

Replaces the JSONB filter_expression column with normalized relational tables:
- filter_groups: stores each group with its position and operator
- filter_group_tags: junction table linking groups to tags

This enables:
- Tags in filters to appear in /tags/ endpoint
- Tag renames to automatically propagate to filters
- Proper FK relationships instead of string references
"""
import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from uuid6 import uuid7


# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: str | Sequence[str] | None = "818b82bc0638"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema: normalize filter_expression to relational tables."""
    connection = op.get_bind()

    # 1. Add group_operator column to content_filters
    op.add_column(
        "content_filters",
        sa.Column("group_operator", sa.String(10), server_default="OR", nullable=False),
    )

    # 2. Create filter_groups table
    op.create_table(
        "filter_groups",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "filter_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("content_filters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("operator", sa.String(10), server_default="AND", nullable=False),
        sa.UniqueConstraint("filter_id", "position", name="uq_filter_groups_filter_position"),
    )
    op.create_index("ix_filter_groups_filter_id", "filter_groups", ["filter_id"])

    # 3. Create filter_group_tags junction table
    op.create_table(
        "filter_group_tags",
        sa.Column(
            "group_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("filter_groups.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("tags.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
    )
    op.create_index("ix_filter_group_tags_tag_id", "filter_group_tags", ["tag_id"])

    # 4. Migrate data from filter_expression JSONB to new tables
    filters = connection.execute(
        sa.text("SELECT id, user_id, filter_expression FROM content_filters")
    ).fetchall()

    for filter_row in filters:
        filter_id = filter_row.id
        user_id = filter_row.user_id
        expression = filter_row.filter_expression

        if not expression:
            continue

        # Extract group_operator and update the column
        group_operator = expression.get("group_operator", "OR")
        connection.execute(
            sa.text("UPDATE content_filters SET group_operator = :op WHERE id = :id"),
            {"op": group_operator, "id": filter_id},
        )

        # Process each group
        for position, group in enumerate(expression.get("groups", [])):
            tag_names = group.get("tags", [])
            operator = group.get("operator", "AND")

            if not tag_names:
                continue

            # Create filter_group
            group_id = str(uuid7())
            connection.execute(
                sa.text(
                    """
                    INSERT INTO filter_groups (id, filter_id, position, operator)
                    VALUES (:id, :filter_id, :position, :operator)
                    """
                ),
                {"id": group_id, "filter_id": filter_id, "position": position, "operator": operator},
            )

            # Get or create tags and link to group
            for tag_name in tag_names:
                normalized_name = tag_name.lower().strip()

                tag_result = connection.execute(
                    sa.text("SELECT id FROM tags WHERE user_id = :user_id AND name = :name"),
                    {"user_id": user_id, "name": normalized_name},
                ).fetchone()

                if tag_result:
                    tag_id = tag_result.id
                else:
                    tag_id = str(uuid7())
                    connection.execute(
                        sa.text("INSERT INTO tags (id, user_id, name) VALUES (:id, :user_id, :name)"),
                        {"id": tag_id, "user_id": user_id, "name": normalized_name},
                    )

                connection.execute(
                    sa.text(
                        """
                        INSERT INTO filter_group_tags (group_id, tag_id)
                        VALUES (:group_id, :tag_id)
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {"group_id": group_id, "tag_id": tag_id},
                )

    # 5. Drop the old filter_expression column
    op.drop_column("content_filters", "filter_expression")


def downgrade() -> None:
    """Downgrade schema: restore filter_expression JSONB from normalized tables."""
    connection = op.get_bind()

    # 1. Re-add filter_expression column
    op.add_column(
        "content_filters",
        sa.Column("filter_expression", JSONB, nullable=True),
    )

    # 2. Reconstruct JSONB from normalized tables
    filters = connection.execute(
        sa.text("SELECT id, group_operator FROM content_filters")
    ).fetchall()

    for filter_row in filters:
        filter_id = filter_row.id
        group_operator = filter_row.group_operator or "OR"

        # Get groups with their tags
        groups_result = connection.execute(
            sa.text(
                """
                SELECT fg.position, fg.operator, array_agg(t.name) as tag_names
                FROM filter_groups fg
                JOIN filter_group_tags fgt ON fgt.group_id = fg.id
                JOIN tags t ON t.id = fgt.tag_id
                WHERE fg.filter_id = :filter_id
                GROUP BY fg.id, fg.position, fg.operator
                ORDER BY fg.position
                """
            ),
            {"filter_id": filter_id},
        ).fetchall()

        groups = [
            {"tags": list(row.tag_names), "operator": row.operator}
            for row in groups_result
        ]

        filter_expression = {"groups": groups, "group_operator": group_operator}

        connection.execute(
            sa.text("UPDATE content_filters SET filter_expression = :expr WHERE id = :id"),
            {"expr": json.dumps(filter_expression), "id": filter_id},
        )

    # 3. Set default for filters with no groups (empty expression)
    connection.execute(
        sa.text(
            """
            UPDATE content_filters
            SET filter_expression = '{"groups": [], "group_operator": "OR"}'
            WHERE filter_expression IS NULL
            """
        )
    )

    # 4. Make filter_expression NOT NULL
    op.alter_column("content_filters", "filter_expression", nullable=False)

    # 5. Drop normalized tables (reverse order of creation)
    op.drop_table("filter_group_tags")
    op.drop_table("filter_groups")

    # 6. Drop group_operator column
    op.drop_column("content_filters", "group_operator")
