"""UserSettings model for storing user preferences."""
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from models.user import User


class UserSettings(Base, TimestampMixin):
    """
    User settings - stores user preferences like sidebar order.

    Sidebar Order Format:
    ---------------------
    The sidebar_order field stores a JSONB object with a flat list of items:

    {
        "version": 1,
        "items": [
            {"type": "builtin", "key": "all"},
            {
                "type": "group",
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "name": "Work",
                "items": [
                    {"type": "list", "id": 3},
                    {"type": "list", "id": 7}
                ]
            },
            {"type": "list", "id": 5},
            {"type": "builtin", "key": "archived"},
            {"type": "builtin", "key": "trash"}
        ]
    }

    Item types:
    - builtin: Built-in navigation items (key: "all", "archived", "trash")
    - list: User-created content lists (id: integer list ID)
    - group: User-created organizational groups (id: UUID, name: string)

    Groups can contain lists and builtins but cannot be nested.
    Lists and builtins can exist at root level or inside groups.

    DEPRECATED: tab_order - Old section-based format, kept for migration compatibility.
    """

    __tablename__ = "user_settings"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tab_order: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="DEPRECATED: Old section-based tab order. Use sidebar_order instead.",
    )
    sidebar_order: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="User's sidebar structure with groups and items. See model docstring.",
    )

    user: Mapped["User"] = relationship("User", back_populates="settings")
