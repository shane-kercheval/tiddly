"""ContentFilter model for storing custom filters with tag-based filter expressions."""
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, TimestampMixin, UUIDv7Mixin

if TYPE_CHECKING:
    from models.filter_group import FilterGroup
    from models.user import User


class ContentFilter(Base, UUIDv7Mixin, TimestampMixin):
    """
    ContentFilter model - stores custom filters with tag-based filter expressions.

    Filter groups use AND logic internally (entity must have ALL tags in the group).
    Groups are combined with OR logic via group_operator.

    Example with 2 groups:
        Group 0: tags ["work", "priority"] (AND)
        Group 1: tags ["urgent"] (AND)
        Filter group_operator: "OR"
    Evaluates to: (work AND priority) OR (urgent)
    """

    __tablename__ = "content_filters"

    # id provided by UUIDv7Mixin
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100))
    content_types: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=["bookmark", "note"],
        comment="Content types this filter applies to: bookmark, note, prompt",
    )
    group_operator: Mapped[str] = mapped_column(String(10), default="OR")
    default_sort_by: Mapped[str | None] = mapped_column(String(20), nullable=True)
    default_sort_ascending: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="content_filters")
    groups: Mapped[list["FilterGroup"]] = relationship(
        back_populates="content_filter",
        cascade="all, delete-orphan",
        order_by="FilterGroup.position",
    )
