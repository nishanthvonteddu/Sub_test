from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from subtracker_api.api.deps import get_statement_import_repo, get_subscription_repo
from subtracker_api.models.imports import (
    CandidateReviewState,
    RecurringTransactionCandidate,
    StatementImportApplyRequest,
    StatementImportApplyResult,
    StatementImportDismissRequest,
    StatementImportReport,
)
from subtracker_api.models.subscription import Cadence, Subscription, SubscriptionCreate
from subtracker_api.repositories.memory_statement_import_repo import MemoryStatementImportRepository
from subtracker_api.repositories.memory_subscription_repo import MemorySubscriptionRepository
from subtracker_api.services.billing import calculate_next_charge
from subtracker_api.services.statement_imports import (
    StatementImportError,
    analyze_statement_pdf,
    build_statement_summary,
)

router = APIRouter(prefix="/statement-imports", tags=["statement-imports"])

MAX_UPLOAD_BYTES = 12 * 1024 * 1024


@router.get("/latest", response_model=StatementImportReport | None)
def get_latest_statement_import(
    repo: MemoryStatementImportRepository = Depends(get_statement_import_repo),
) -> StatementImportReport | None:
    return repo.latest()


@router.post("/pdf", response_model=StatementImportReport)
async def upload_statement_pdf(
    file: UploadFile = File(...),
    repo: MemoryStatementImportRepository = Depends(get_statement_import_repo),
    subscription_repo: MemorySubscriptionRepository = Depends(get_subscription_repo),
) -> StatementImportReport:
    filename = file.filename or "statement.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Upload a PDF statement file.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The PDF is empty.")
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="The PDF is too large. Upload a file smaller than 12 MB.",
        )

    try:
        report = analyze_statement_pdf(
            file_bytes,
            filename=filename,
            existing_subscriptions=subscription_repo.list(),
        )
    except StatementImportError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return repo.save(report)


@router.post("/{report_id}/apply", response_model=StatementImportApplyResult)
def apply_statement_candidates(
    report_id: UUID,
    payload: StatementImportApplyRequest,
    repo: MemoryStatementImportRepository = Depends(get_statement_import_repo),
    subscription_repo: MemorySubscriptionRepository = Depends(get_subscription_repo),
) -> StatementImportApplyResult:
    report = repo.get(report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Statement import not found")

    selected_ids = set(payload.candidate_ids)
    seen_ids: set[str] = set()
    created: list[Subscription] = []
    updated: list[Subscription] = []
    skipped: list[str] = []
    next_candidates: list[RecurringTransactionCandidate] = []

    for candidate in report.candidates:
        if candidate.candidate_id not in selected_ids:
            next_candidates.append(candidate)
            continue

        seen_ids.add(candidate.candidate_id)
        if candidate.review_state == CandidateReviewState.IMPORTED:
            skipped.append(candidate.candidate_id)
            next_candidates.append(candidate)
            continue

        existing = (
            subscription_repo.get(candidate.matched_subscription_id)
            if candidate.matched_subscription_id is not None
            else None
        )
        subscription = build_subscription_from_candidate(candidate, existing=existing, today=date.today())
        if existing is None:
            subscription_repo.add(subscription)
            created.append(subscription)
        else:
            subscription_repo.update(subscription)
            updated.append(subscription)

        next_candidates.append(
            candidate.model_copy(
                update={
                    "review_state": CandidateReviewState.IMPORTED,
                    "applied_subscription_id": subscription.id,
                }
            )
        )

    skipped.extend(sorted(selected_ids - seen_ids))
    updated_report = report.model_copy(update={"candidates": next_candidates})
    updated_report = updated_report.model_copy(update={"summary": build_statement_summary(updated_report)})
    repo.save(updated_report)

    return StatementImportApplyResult(
        report=updated_report,
        created_subscriptions=created,
        updated_subscriptions=updated,
        skipped_candidate_ids=skipped,
    )


@router.post("/{report_id}/dismiss", response_model=StatementImportReport)
def dismiss_statement_candidates(
    report_id: UUID,
    payload: StatementImportDismissRequest,
    repo: MemoryStatementImportRepository = Depends(get_statement_import_repo),
) -> StatementImportReport:
    report = repo.get(report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Statement import not found")

    selected_ids = set(payload.candidate_ids)
    next_candidates: list[RecurringTransactionCandidate] = []

    for candidate in report.candidates:
        if (
            candidate.candidate_id in selected_ids
            and candidate.review_state not in {CandidateReviewState.IMPORTED, CandidateReviewState.DISMISSED}
        ):
            next_candidates.append(
                candidate.model_copy(update={"review_state": CandidateReviewState.DISMISSED})
            )
            continue

        next_candidates.append(candidate)

    updated_report = report.model_copy(update={"candidates": next_candidates})
    updated_report = updated_report.model_copy(update={"summary": build_statement_summary(updated_report)})
    return repo.save(updated_report)


def build_subscription_from_candidate(
    candidate: RecurringTransactionCandidate,
    *,
    existing: Subscription | None,
    today: date,
) -> Subscription:
    cadence = candidate.cadence
    notes = merge_notes(existing.notes if existing else None, candidate)
    payload = SubscriptionCreate(
        name=existing.name if existing else candidate.name,
        vendor=candidate.vendor,
        amount=round(candidate.latest_amount, 2),
        currency=candidate.currency,
        cadence=cadence,
        status=candidate.suggested_status,
        start_date=min(existing.start_date, candidate.first_seen_on) if existing else candidate.first_seen_on,
        end_date=None,
        day_of_month=candidate.suggested_day_of_month if cadence == Cadence.MONTHLY else None,
        notes=notes,
    )

    values = payload.model_dump()
    subscription_values = {
        **values,
        "next_charge_date": calculate_next_charge(payload, today=today),
    }
    if existing is not None:
        subscription_values["id"] = existing.id
        subscription_values["created_at"] = existing.created_at

    return Subscription(**subscription_values)


def merge_notes(existing_notes: str | None, candidate: RecurringTransactionCandidate) -> str:
    sync_note = (
        f"Statement-backed: {candidate.occurrence_count} recurring charges detected through "
        f"{candidate.last_seen_on.isoformat()}."
    )
    if existing_notes:
        if sync_note in existing_notes:
            return existing_notes[:300]
        return f"{existing_notes} | {sync_note}"[:300]
    return sync_note[:300]
