"""UserSettings model for storing user preferences."""
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
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
                    {"type": "list", "id": "01938a12-3b45-7c67-8d90-ef1234567890"},
                    {"type": "list", "id": "01938a12-3b45-7c67-8d90-ef1234567891"}
                ]
            },
            {"type": "list", "id": "01938a12-3b45-7c67-8d90-ef1234567892"},
            {"type": "builtin", "key": "archived"},
            {"type": "builtin", "key": "trash"}
        ]
    }

    Item types:
    - builtin: Built-in navigation items (key: "all", "archived", "trash")
    - list: User-created content lists (id: UUID string)
    - group: User-created organizational groups (id: UUID, name: string)

    Groups can contain lists and builtins but cannot be nested.
    Lists and builtins can exist at root level or inside groups.
    """

    __tablename__ = "user_settings"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    sidebar_order: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="User's sidebar structure with groups and items. See model docstring.",
    )

    user: Mapped["User"] = relationship("User", back_populates="settings")
