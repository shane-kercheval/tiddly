"""add_sidebar_order_column

Revision ID: a1b2c3d4e5f6
Revises: 9b814e3de951
Create Date: 2025-12-28 10:00:00.000000

Adds sidebar_order column to user_settings and migrates existing tab_order data.

Old format (tab_order):
    {
        "sections": {
            "shared": ["all", "archived", "trash", "list:456"],
            "bookmarks": ["all-bookmarks", "list:123"],
            "notes": ["all-notes", "list:234"]
        },
        "section_order": ["shared", "bookmarks", "notes"]
    }

New format (sidebar_order):
    {
        "version": 1,
        "items": [
            {"type": "builtin", "key": "all"},
            {"type": "list", "id": 456},
            {"type": "builtin", "key": "archived"},
            {"type": "builtin", "key": "trash"},
            {"type": "list", "id": 123},
            {"type": "list", "id": 234}
        ]
    }

Migration strategy:
- Flatten all sections to root level
- Remove "all-bookmarks" and "all-notes" built-in items
- Users can recreate groups as desired
"""
import json
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "9b814e3de951"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


SIDEBAR_VERSION = 1


def get_default_sidebar_order() -> dict:
    """Return the default sidebar structure for new users."""
    return {
        "version": SIDEBAR_VERSION,
        "items": [
            {"type": "builtin", "key": "all"},
            {"type": "builtin", "key": "archived"},
            {"type": "builtin", "key": "trash"},
        ],
    }


def migrate_tab_order_to_sidebar(old: dict | None) -> dict:
    """
    Convert old tab_order to new sidebar_order.

    Flattens all sections to root level. Users can recreate groups as desired.
    """
    if old is None:
        return get_default_sidebar_order()

    # If it doesn't have "sections", it's not the expected format
    if "sections" not in old:
        return get_default_sidebar_order()

    items: list[dict] = []
    seen_builtins: set[str] = set()
    seen_lists: set[int] = set()

    # Flatten items from each old section, in section_order
    section_order = old.get("section_order", ["shared", "bookmarks", "notes"])
    sections = old.get("sections", {})

    for section_name in section_order:
        section_items = sections.get(section_name, [])
        for item_key in section_items:
            if item_key in ("all", "archived", "trash"):
                if item_key not in seen_builtins:
                    items.append({"type": "builtin", "key": item_key})
                    seen_builtins.add(item_key)
            elif item_key.startswith("list:"):
                try:
                    list_id = int(item_key.split(":")[1])
                    if list_id not in seen_lists:
                        items.append({"type": "list", "id": list_id})
                        seen_lists.add(list_id)
                except (ValueError, IndexError):
                    # Skip malformed list keys
                    pass
            # Skip "all-bookmarks", "all-notes" - they're removed

    # Ensure all builtins are present
    for builtin in ["all", "archived", "trash"]:
        if builtin not in seen_builtins:
            items.append({"type": "builtin", "key": builtin})

    return {"version": SIDEBAR_VERSION, "items": items}


def migrate_sidebar_to_tab_order(sidebar: dict | None) -> dict | None:
    """
    Convert new sidebar_order back to old tab_order format.

    For downgrade purposes. Groups are flattened.
    """
    if sidebar is None:
        return None

    items = sidebar.get("items", [])
    if not items:
        return None

    # Categorize items back into sections
    shared_items: list[str] = []
    bookmark_items: list[str] = ["all-bookmarks"]  # Always include for old format
    note_items: list[str] = ["all-notes"]  # Always include for old format

    def process_item(item: dict) -> None:
        """Process a single item and add to appropriate section."""
        item_type = item.get("type")
        if item_type == "builtin":
            key = item.get("key")
            if key in ("all", "archived", "trash"):
                shared_items.append(key)
        elif item_type == "list":
            list_id = item.get("id")
            if list_id is not None:
                # Put all lists in shared section for simplicity
                shared_items.append(f"list:{list_id}")
        elif item_type == "group":
            # Flatten group items
            for child in item.get("items", []):
                process_item(child)

    for item in items:
        process_item(item)

    return {
        "sections": {
            "shared": shared_items,
            "bookmarks": bookmark_items,
            "notes": note_items,
        },
        "section_order": ["shared", "bookmarks", "notes"],
    }


def upgrade() -> None:
    """Add sidebar_order column and migrate existing tab_order data."""
    # Add the new column
    op.add_column(
        "user_settings",
        sa.Column(
            "sidebar_order",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="User's sidebar structure with groups and items. See model docstring.",
        ),
    )

    # Update tab_order column comment
    op.alter_column(
        "user_settings",
        "tab_order",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        comment="DEPRECATED: Old section-based tab order. Use sidebar_order instead.",
        existing_nullable=True,
    )

    # Migrate existing data
    connection = op.get_bind()

    # Get all user_settings rows
    result = connection.execute(
        sa.text("SELECT user_id, tab_order FROM user_settings"),
    )

    for row in result:
        user_id = row[0]
        old_tab_order = row[1]

        # Convert to new format
        new_sidebar_order = migrate_tab_order_to_sidebar(old_tab_order)

        # Update the row
        connection.execute(
            sa.text(
                "UPDATE user_settings SET sidebar_order = :new_value WHERE user_id = :user_id",
            ),
            {"new_value": json.dumps(new_sidebar_order), "user_id": user_id},
        )


def downgrade() -> None:
    """Remove sidebar_order column."""
    # Migrate sidebar_order data back to tab_order for any new entries
    connection = op.get_bind()

    result = connection.execute(
        sa.text(
            "SELECT user_id, sidebar_order FROM user_settings WHERE sidebar_order IS NOT NULL",
        ),
    )

    for row in result:
        user_id = row[0]
        sidebar_order = row[1]

        # Convert back to old format
        old_tab_order = migrate_sidebar_to_tab_order(sidebar_order)

        if old_tab_order is not None:
            connection.execute(
                sa.text(
                    "UPDATE user_settings SET tab_order = :old_value WHERE user_id = :user_id",
                ),
                {"old_value": json.dumps(old_tab_order), "user_id": user_id},
            )

    # Restore tab_order column comment
    op.alter_column(
        "user_settings",
        "tab_order",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        comment="Structured tab order with sections. See model docstring for format.",
        existing_nullable=True,
    )

    # Drop the sidebar_order column
    op.drop_column("user_settings", "sidebar_order")
