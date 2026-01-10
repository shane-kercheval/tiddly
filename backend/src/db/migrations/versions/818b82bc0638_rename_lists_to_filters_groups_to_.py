"""rename_lists_to_filters_groups_to_collections

Revision ID: 818b82bc0638
Revises: cc7d7d58ce2e
Create Date: 2026-01-10 15:08:35.714614

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '818b82bc0638'
down_revision: Union[str, Sequence[str], None] = 'cc7d7d58ce2e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. Rename table from content_lists to content_filters
    op.rename_table('content_lists', 'content_filters')

    # 2. Rename all indexes to match new table name
    op.execute('ALTER INDEX ix_content_lists_user_id RENAME TO ix_content_filters_user_id')
    op.execute('ALTER INDEX ix_content_lists_updated_at RENAME TO ix_content_filters_updated_at')

    # 3. Update sidebar_order JSONB in user_settings
    # Replace type: "list" with type: "filter"
    # Replace type: "group" with type: "collection"
    op.execute("""
        UPDATE user_settings
        SET sidebar_order = (
            SELECT jsonb_set(
                sidebar_order,
                '{items}',
                (
                    SELECT COALESCE(jsonb_agg(
                        CASE
                            WHEN item->>'type' = 'list' THEN
                                jsonb_set(item, '{type}', '"filter"')
                            WHEN item->>'type' = 'group' THEN
                                jsonb_set(
                                    jsonb_set(item, '{type}', '"collection"'),
                                    '{items}',
                                    (
                                        SELECT COALESCE(jsonb_agg(
                                            CASE
                                                WHEN sub_item->>'type' = 'list' THEN
                                                    jsonb_set(sub_item, '{type}', '"filter"')
                                                ELSE sub_item
                                            END
                                        ), '[]'::jsonb)
                                        FROM jsonb_array_elements(item->'items') AS sub_item
                                    )
                                )
                            ELSE item
                        END
                    ), '[]'::jsonb)
                    FROM jsonb_array_elements(sidebar_order->'items') AS item
                )
            )
        )
        WHERE sidebar_order IS NOT NULL
          AND sidebar_order ? 'items'
    """)


def downgrade() -> None:
    """Downgrade schema."""
    # 1. Revert sidebar_order JSONB changes
    op.execute("""
        UPDATE user_settings
        SET sidebar_order = (
            SELECT jsonb_set(
                sidebar_order,
                '{items}',
                (
                    SELECT COALESCE(jsonb_agg(
                        CASE
                            WHEN item->>'type' = 'filter' THEN
                                jsonb_set(item, '{type}', '"list"')
                            WHEN item->>'type' = 'collection' THEN
                                jsonb_set(
                                    jsonb_set(item, '{type}', '"group"'),
                                    '{items}',
                                    (
                                        SELECT COALESCE(jsonb_agg(
                                            CASE
                                                WHEN sub_item->>'type' = 'filter' THEN
                                                    jsonb_set(sub_item, '{type}', '"list"')
                                                ELSE sub_item
                                            END
                                        ), '[]'::jsonb)
                                        FROM jsonb_array_elements(item->'items') AS sub_item
                                    )
                                )
                            ELSE item
                        END
                    ), '[]'::jsonb)
                    FROM jsonb_array_elements(sidebar_order->'items') AS item
                )
            )
        )
        WHERE sidebar_order IS NOT NULL
          AND sidebar_order ? 'items'
    """)

    # 2. Rename all indexes back
    op.execute('ALTER INDEX ix_content_filters_user_id RENAME TO ix_content_lists_user_id')
    op.execute('ALTER INDEX ix_content_filters_updated_at RENAME TO ix_content_lists_updated_at')

    # 3. Rename table back
    op.rename_table('content_filters', 'content_lists')
