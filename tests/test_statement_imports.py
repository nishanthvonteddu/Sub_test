from datetime import date

import pytest
from fastapi.testclient import TestClient

from subtracker_api.models.subscription import Subscription, SubscriptionCreate
from subtracker_api.services.billing import calculate_next_charge
from subtracker_api.services.statement_imports import (
    StatementImportError,
    analyze_statement_text,
)


SAMPLE_STATEMENT_TEXT = """
Statement Period 01/01/2026 - 03/10/2026
01/03/2026 NETFLIX.COM 19.99 2200.00
02/03/2026 NETFLIX.COM 19.99 2180.01
03/03/2026 NETFLIX.COM 19.99 2160.02
01/05/2026 SPOTIFY FAMILY PLAN 10.99 2149.03
02/05/2026 SPOTIFY FAMILY PLAN 12.49 2138.04
03/05/2026 SPOTIFY FAMILY PLAN 10.99 2127.05
02/13/2026 FRESH BOX 34.50 2092.55
02/20/2026 FRESH BOX 34.50 2058.05
02/27/2026 FRESH BOX 34.50 2023.55
03/06/2026 FRESH BOX 34.50 1989.05
02/01/2026 CREDIT CARD PAYMENT 200.00 1823.55
03/01/2026 PAYROLL 3000.00 4823.55
03/09/2026 ONE OFF MARKET 83.12 1905.93
"""


def make_subscription(payload: SubscriptionCreate) -> Subscription:
    return Subscription(**payload.model_dump(), next_charge_date=calculate_next_charge(payload))


def test_analyze_statement_text_detects_weekly_and_monthly_candidates() -> None:
    report = analyze_statement_text(
        SAMPLE_STATEMENT_TEXT,
        filename="march-statement.pdf",
        existing_subscriptions=[],
        today=date(2026, 3, 10),
        page_count=3,
    )

    assert report.summary.transaction_count == 11
    assert report.summary.recurring_candidate_count == 3
    assert report.summary.ready_candidate_count == 3
    assert report.summary.coverage_start == date(2026, 1, 3)
    assert report.summary.coverage_end == date(2026, 3, 9)
    assert report.summary.top_candidate_vendor == "Fresh Box"

    candidates = {item.vendor: item for item in report.candidates}
    assert candidates["Netflix"].cadence == "monthly"
    assert candidates["Netflix"].next_expected_on == date(2026, 4, 3)
    assert candidates["Spotify Family Plan"].variable_amount is True
    assert candidates["Fresh Box"].cadence == "weekly"
    assert candidates["Fresh Box"].next_expected_on == date(2026, 3, 13)


def test_analyze_statement_text_marks_matching_existing_subscriptions() -> None:
    netflix = make_subscription(
        SubscriptionCreate(
            name="Netflix",
            vendor="Netflix",
            amount=19.99,
            currency="USD",
            cadence="monthly",
            start_date=date(2025, 8, 3),
            day_of_month=3,
        )
    )

    report = analyze_statement_text(
        SAMPLE_STATEMENT_TEXT,
        filename="march-statement.pdf",
        existing_subscriptions=[netflix],
        today=date(2026, 3, 10),
    )

    netflix_candidate = next(item for item in report.candidates if item.vendor == "Netflix")
    assert netflix_candidate.review_state == "matched"
    assert netflix_candidate.matched_subscription_id == netflix.id
    assert netflix_candidate.matched_subscription_name == "Netflix"


def test_analyze_statement_text_rejects_non_transaction_content() -> None:
    with pytest.raises(StatementImportError):
        analyze_statement_text(
            "Statement summary only\nNo activity this period",
            filename="empty.pdf",
            existing_subscriptions=[],
            today=date(2026, 3, 10),
        )


def test_upload_statement_pdf_and_apply_candidates(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    existing_netflix = make_subscription(
        SubscriptionCreate(
            name="Netflix",
            vendor="Netflix",
            amount=18.99,
            currency="USD",
            cadence="monthly",
            start_date=date(2025, 10, 3),
            day_of_month=3,
            notes="Legacy import",
        )
    )
    client.app.state.subscription_repo.add(existing_netflix)

    def fake_analyze_statement_pdf(
        file_bytes: bytes,
        filename: str,
        existing_subscriptions: list[Subscription],
        today: date | None = None,
    ):
        return analyze_statement_text(
            SAMPLE_STATEMENT_TEXT,
            filename=filename,
            existing_subscriptions=existing_subscriptions,
            today=today or date(2026, 3, 10),
            page_count=2,
        )

    monkeypatch.setattr(
        "subtracker_api.api.routes.statement_imports.analyze_statement_pdf",
        fake_analyze_statement_pdf,
    )

    upload_response = client.post(
        "/statement-imports/pdf",
        files={"file": ("statement.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert upload_response.status_code == 200

    report = upload_response.json()
    assert report["summary"]["recurring_candidate_count"] == 3
    selected_ids = [
        item["candidate_id"]
        for item in report["candidates"]
        if item["vendor"] in {"Netflix", "Fresh Box"}
    ]

    apply_response = client.post(
        f"/statement-imports/{report['id']}/apply",
        json={"candidate_ids": selected_ids},
    )
    assert apply_response.status_code == 200
    body = apply_response.json()
    assert len(body["updated_subscriptions"]) == 1
    assert len(body["created_subscriptions"]) == 1

    subscriptions = client.get("/subscriptions").json()
    assert len(subscriptions) == 2
    assert any(item["vendor"] == "Netflix" and item["amount"] == 19.99 for item in subscriptions)
    assert any(item["vendor"] == "Fresh Box" for item in subscriptions)

    latest_response = client.get("/statement-imports/latest")
    assert latest_response.status_code == 200
    latest = latest_response.json()
    assert latest["summary"]["imported_candidate_count"] == 2
    assert all(
        candidate["review_state"] == "imported"
        for candidate in latest["candidates"]
        if candidate["candidate_id"] in selected_ids
    )


def test_upload_statement_pdf_rejects_non_pdf_files(client: TestClient) -> None:
    response = client.post(
        "/statement-imports/pdf",
        files={"file": ("statement.txt", b"not a pdf", "text/plain")},
    )
    assert response.status_code == 415
