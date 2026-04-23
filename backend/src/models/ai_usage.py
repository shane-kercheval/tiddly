"""AI usage tracking model for cost analytics."""
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import DateTime, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class AiUsage(Base):
    """
    Hourly AI usage buckets for cost tracking and analytics.

    Each row represents one unique combination of
    (hour, user, use_case, model, key_source) with aggregated
    request count and total cost. Populated by the hourly flush
    cron job from Redis ai_stats:* keys.
    """

    __tablename__ = "ai_usage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bucket_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    use_case: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[str] = mapped_column(String, nullable=False)
    key_source: Mapped[str] = mapped_column(String, nullable=False)
    request_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cost: Mapped[Decimal] = mapped_column(Numeric, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "bucket_start", "user_id", "use_case", "model", "key_source",
            name="uq_ai_usage_bucket",
        ),
        Index("ix_ai_usage_user_bucket", "user_id", "bucket_start"),
    )
