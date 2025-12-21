"""User consent model for tracking privacy policy and ToS acceptance."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class UserConsent(Base):
    """User consent tracking for GDPR compliance."""

    __tablename__ = "user_consents"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        comment="Foreign key to users table - one consent record per user",
    )
    consented_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        comment="Timestamp when user accepted the terms",
    )
    privacy_policy_version: Mapped[str] = mapped_column(
        String(50),
        comment="Version of privacy policy accepted (e.g., '2024-12-20')",
    )
    terms_of_service_version: Mapped[str] = mapped_column(
        String(50),
        comment="Version of terms of service accepted (e.g., '2024-12-20')",
    )
    ip_address: Mapped[str | None] = mapped_column(
        String(45),  # IPv6 max length is 45 chars
        nullable=True,
        comment="IP address at time of consent (for legal proof)",
    )
    user_agent: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Browser user agent at time of consent (for legal proof)",
    )

    # Relationship
    user: Mapped["User"] = relationship(back_populates="consent")  # noqa: F821
