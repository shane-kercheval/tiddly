"""Prompt model for MCP prompt server."""
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from models.user import User


class Prompt(Base, TimestampMixin):
    """
    User-defined prompt for the MCP prompt server.

    Each prompt is a Jinja2 template with defined arguments.
    Prompts are served via the Prompt MCP Server.
    """

    __tablename__ = "prompts"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_prompts_user_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Name is the MCP prompt identifier and URL path
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Prompt identifier, unique per user (e.g., 'code-review')",
    )

    # Title is the optional human-readable display name
    title: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Optional display title (e.g., 'Code Review Assistant')",
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Optional description",
    )

    # Jinja2 template content
    content: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Jinja2 template content",
    )

    # Prompt arguments as JSONB
    arguments: Mapped[list[dict]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        comment="Prompt arguments: [{name: str, description: str?, required: bool?}]",
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="prompts")
