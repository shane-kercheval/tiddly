"""ContentFilter model for storing custom filters with tag-based filter expressions."""
from typing import TYPE_CHECKING, Any
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

    @property
    def filter_expression(self) -> dict[str, Any]:
        """
        Reconstruct filter_expression dict from normalized groups.

        Returns the same format as the original JSONB column for backwards
        compatibility with existing filter application logic.

        Example output:
        {
            "groups": [
                {"tags": ["work", "priority"], "operator": "AND"},
                {"tags": ["urgent"], "operator": "AND"}
            ],
            "group_operator": "OR"
        }

        Note: Requires groups relationship to be eagerly loaded, otherwise
        may trigger lazy loading which doesn't work in async context.
        """
        # Access via __dict__ to avoid lazy loading issues in async context
        loaded_groups = self.__dict__.get("groups")
        if loaded_groups is None:
            return {"groups": [], "group_operator": self.group_operator}

        groups = []
        for group in sorted(loaded_groups, key=lambda g: g.position):
            # Also check tag_objects via __dict__ to avoid lazy loading
            loaded_tags = group.__dict__.get("tag_objects")
            tag_names = sorted(tag.name for tag in loaded_tags) if loaded_tags else []
            groups.append({"tags": tag_names, "operator": group.operator})

        return {"groups": groups, "group_operator": self.group_operator}
