from __future__ import annotations

from datetime import UTC, date, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Cadence(StrEnum):
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class SubscriptionStatus(StrEnum):
    ACTIVE = "active"
    PAUSED = "paused"
    CANCELED = "canceled"


class SubscriptionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    vendor: str = Field(min_length=1, max_length=100)
    amount: float = Field(gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    cadence: Cadence = Cadence.MONTHLY
    status: SubscriptionStatus = SubscriptionStatus.ACTIVE
    start_date: date = Field(default_factory=date.today)
    end_date: date | None = None
    day_of_month: int | None = Field(default=None, ge=1, le=31)
    notes: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def validate_date_window(self) -> SubscriptionCreate:
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class SubscriptionStatusUpdate(BaseModel):
    status: SubscriptionStatus


class Subscription(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(default_factory=uuid4)
    name: str
    vendor: str
    amount: float
    currency: str
    cadence: Cadence
    status: SubscriptionStatus
    start_date: date
    end_date: date | None
    day_of_month: int | None
    notes: str | None
    next_charge_date: date | None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
