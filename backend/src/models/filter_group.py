"""FilterGroup model for storing filter groups with tag relationships."""
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, UUIDv7Mixin

if TYPE_CHECKING:
    from models.content_filter import ContentFilter
    from models.tag import Tag


class FilterGroup(Base, UUIDv7Mixin):
    """
    FilterGroup model - stores groups within a content filter.

    Each group contains tags that are combined with AND logic.
    Groups are combined with OR logic at the filter level.

    Example filter with 2 groups:
        Group 0: tags ["work", "priority"] (AND)
        Group 1: tags ["urgent"] (AND)
        Filter group_operator: "OR"
    Evaluates to: (work AND priority) OR (urgent)
    """

    __tablename__ = "filter_groups"
    __table_args__ = (
        UniqueConstraint("filter_id", "position", name="uq_filter_groups_filter_position"),
    )

    # id provided by UUIDv7Mixin
    filter_id: Mapped[UUID] = mapped_column(
        ForeignKey("content_filters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(nullable=False)
    operator: Mapped[str] = mapped_column(String(10), default="AND")

    # Relationships
    content_filter: Mapped["ContentFilter"] = relationship(back_populates="groups")
    tag_objects: Mapped[list["Tag"]] = relationship(
        secondary="filter_group_tags",
    )
