from __future__ import annotations

from datetime import UTC, date, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

from subtracker_api.models.subscription import Cadence, Subscription, SubscriptionStatus


class CandidateConfidenceLabel(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class CandidateReviewState(StrEnum):
    READY = "ready"
    MATCHED = "matched"
    IMPORTED = "imported"
    DISMISSED = "dismissed"


class CurrencyTotal(BaseModel):
    currency: str = Field(default="USD", min_length=3, max_length=3)
    amount: float = Field(ge=0)


class StatementTransaction(BaseModel):
    transaction_id: str
    posted_on: date
    description: str
    merchant: str
    amount: float = Field(gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    raw_line: str


class RecurringTransactionCandidate(BaseModel):
    candidate_id: str
    name: str
    vendor: str
    normalized_vendor: str
    cadence: Cadence
    review_state: CandidateReviewState = CandidateReviewState.READY
    confidence: float = Field(ge=0, le=1)
    confidence_label: CandidateConfidenceLabel
    average_amount: float = Field(gt=0)
    latest_amount: float = Field(gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    occurrence_count: int = Field(ge=2)
    first_seen_on: date
    last_seen_on: date
    next_expected_on: date | None = None
    suggested_day_of_month: int | None = Field(default=None, ge=1, le=31)
    suggested_status: SubscriptionStatus
    variable_amount: bool = False
    matched_subscription_id: UUID | None = None
    matched_subscription_name: str | None = None
    applied_subscription_id: UUID | None = None
    notes: str | None = None
    source_transaction_ids: list[str] = Field(default_factory=list)


class StatementImportSummary(BaseModel):
    report_id: UUID
    filename: str
    created_at: datetime
    page_count: int = Field(ge=0)
    transaction_count: int = Field(ge=0)
    recurring_candidate_count: int = Field(ge=0)
    ready_candidate_count: int = Field(ge=0)
    matched_candidate_count: int = Field(ge=0)
    imported_candidate_count: int = Field(ge=0)
    low_confidence_candidate_count: int = Field(ge=0)
    coverage_start: date | None = None
    coverage_end: date | None = None
    estimated_monthly_totals: list[CurrencyTotal] = Field(default_factory=list)
    top_candidate_vendor: str | None = None
    next_expected_charge: date | None = None
    warnings: list[str] = Field(default_factory=list)


class StatementImportReport(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(default_factory=uuid4)
    filename: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    page_count: int = Field(ge=0)
    transactions: list[StatementTransaction] = Field(default_factory=list)
    candidates: list[RecurringTransactionCandidate] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    coverage_start: date | None = None
    coverage_end: date | None = None
    summary: StatementImportSummary


class StatementImportApplyRequest(BaseModel):
    candidate_ids: list[str] = Field(min_length=1)


class StatementImportDismissRequest(BaseModel):
    candidate_ids: list[str] = Field(min_length=1)


class StatementImportApplyResult(BaseModel):
    report: StatementImportReport
    created_subscriptions: list[Subscription] = Field(default_factory=list)
    updated_subscriptions: list[Subscription] = Field(default_factory=list)
    skipped_candidate_ids: list[str] = Field(default_factory=list)
