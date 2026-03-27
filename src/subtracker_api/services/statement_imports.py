from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from hashlib import sha1
from io import BytesIO
from statistics import fmean
from typing import NamedTuple
from uuid import uuid4

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from subtracker_api.models.imports import (
    CandidateConfidenceLabel,
    CandidateReviewState,
    CurrencyTotal,
    RecurringTransactionCandidate,
    StatementImportReport,
    StatementImportSummary,
    StatementTransaction,
)
from subtracker_api.models.subscription import Cadence, Subscription, SubscriptionStatus


class StatementImportError(ValueError):
    pass


class ParsedDate(NamedTuple):
    value: date
    end: int


@dataclass(slots=True)
class CadenceGuess:
    cadence: Cadence
    score: float
    next_expected_on: date
    suggested_day_of_month: int | None


DATE_PATTERNS = (
    re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})\b"),
    re.compile(r"^\s*(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b"),
    re.compile(r"^\s*([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{4}))?\b"),
)
AMOUNT_PATTERN = re.compile(r"\(?-?(?:USD|EUR|GBP|AUD|CAD)?\s*[$€£]?\d[\d,]*\.\d{2}\)?")
MONTH_LOOKUP = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}
CURRENCY_SYMBOLS = {
    "$": "USD",
    "€": "EUR",
    "£": "GBP",
}
SKIP_DESCRIPTION_HINTS = (
    "balance",
    "previous balance",
    "new balance",
    "available credit",
    "credit limit",
    "minimum payment",
    "payment due",
    "total fees",
    "interest charge",
    "interest charged",
    "statement period",
    "account summary",
    "daily balance",
)
CREDIT_DESCRIPTION_HINTS = (
    "payment",
    "refund",
    "credit",
    "deposit",
    "payroll",
    "direct dep",
    "transfer",
    "zelle",
    "venmo",
    "cash app",
    "reversal",
)
MERCHANT_NOISE = {
    "ACH",
    "ACHD",
    "ACHDR",
    "ACHPMT",
    "AND",
    "AUTH",
    "AUTOPAY",
    "CARD",
    "CHECK",
    "COM",
    "COMPANY",
    "DBT",
    "DEBIT",
    "ONLINE",
    "PAYMENT",
    "POS",
    "PURCHASE",
    "RECURRING",
    "TRANS",
    "TRANSACTION",
    "WWW",
    "XFER",
}


def analyze_statement_pdf(
    file_bytes: bytes,
    filename: str,
    existing_subscriptions: list[Subscription],
    today: date | None = None,
) -> StatementImportReport:
    page_text, page_count, warnings = extract_pdf_text(file_bytes)
    report = analyze_statement_text(
        page_text,
        filename=filename,
        existing_subscriptions=existing_subscriptions,
        today=today,
        page_count=page_count,
    )
    if warnings:
        combined = [*report.warnings, *warnings]
        summary = build_statement_summary(report.model_copy(update={"warnings": combined}))
        return report.model_copy(update={"warnings": combined, "summary": summary})
    return report


def analyze_statement_text(
    document_text: str,
    *,
    filename: str,
    existing_subscriptions: list[Subscription],
    today: date | None = None,
    page_count: int = 1,
) -> StatementImportReport:
    reference_date = today or date.today()
    reference_year = detect_reference_year(document_text, reference_date.year)
    transactions = parse_statement_transactions(document_text, reference_year, reference_date)

    if not transactions:
        raise StatementImportError(
            "No transaction rows were found. Upload a text-based bank or card statement PDF."
        )

    candidates = detect_recurring_candidates(
        transactions,
        existing_subscriptions=existing_subscriptions,
        reference_date=reference_date,
    )

    warnings: list[str] = []
    if len(transactions) < 6:
        warnings.append(
            "Only a small number of debit transactions were parsed. Uploading multiple statement periods improves detection."
        )
    if not candidates:
        warnings.append(
            "No recurring charges were detected. Monthly imports usually need at least two observed charges."
        )

    report_id = uuid4()
    created_at = datetime.now(UTC)
    report = StatementImportReport(
        id=report_id,
        filename=filename,
        created_at=created_at,
        page_count=page_count,
        transactions=transactions,
        candidates=candidates,
        warnings=warnings,
        coverage_start=min((item.posted_on for item in transactions), default=None),
        coverage_end=max((item.posted_on for item in transactions), default=None),
        summary=StatementImportSummary(
            report_id=report_id,
            filename=filename,
            created_at=created_at,
            page_count=page_count,
            transaction_count=len(transactions),
            recurring_candidate_count=len(candidates),
            ready_candidate_count=sum(
                1 for item in candidates if item.review_state == CandidateReviewState.READY
            ),
            matched_candidate_count=sum(
                1 for item in candidates if item.review_state == CandidateReviewState.MATCHED
            ),
            imported_candidate_count=0,
            low_confidence_candidate_count=sum(
                1 for item in candidates if item.confidence_label == CandidateConfidenceLabel.LOW
            ),
            coverage_start=min((item.posted_on for item in transactions), default=None),
            coverage_end=max((item.posted_on for item in transactions), default=None),
        ),
    )
    summary = build_statement_summary(report)
    return report.model_copy(update={"summary": summary})


def build_statement_summary(report: StatementImportReport) -> StatementImportSummary:
    ready_count = sum(1 for item in report.candidates if item.review_state == CandidateReviewState.READY)
    matched_count = sum(
        1 for item in report.candidates if item.review_state == CandidateReviewState.MATCHED
    )
    imported_count = sum(
        1 for item in report.candidates if item.review_state == CandidateReviewState.IMPORTED
    )
    low_confidence_count = sum(
        1 for item in report.candidates if item.confidence_label == CandidateConfidenceLabel.LOW
    )

    totals: dict[str, float] = defaultdict(float)
    for candidate in report.candidates:
        totals[candidate.currency] += monthly_equivalent(candidate.latest_amount, candidate.cadence)

    estimated_monthly_totals = [
        CurrencyTotal(currency=currency, amount=round(amount, 2))
        for currency, amount in sorted(totals.items())
    ]

    top_candidate = max(
        report.candidates,
        key=lambda item: monthly_equivalent(item.latest_amount, item.cadence),
        default=None,
    )
    next_expected = min(
        (item.next_expected_on for item in report.candidates if item.next_expected_on),
        default=None,
    )

    return StatementImportSummary(
        report_id=report.id,
        filename=report.filename,
        created_at=report.created_at,
        page_count=report.page_count,
        transaction_count=len(report.transactions),
        recurring_candidate_count=len(report.candidates),
        ready_candidate_count=ready_count,
        matched_candidate_count=matched_count,
        imported_candidate_count=imported_count,
        low_confidence_candidate_count=low_confidence_count,
        coverage_start=report.coverage_start,
        coverage_end=report.coverage_end,
        estimated_monthly_totals=estimated_monthly_totals,
        top_candidate_vendor=top_candidate.vendor if top_candidate else None,
        next_expected_charge=next_expected,
        warnings=report.warnings,
    )


def extract_pdf_text(file_bytes: bytes) -> tuple[str, int, list[str]]:
    try:
        reader = PdfReader(BytesIO(file_bytes))
    except PdfReadError as exc:
        raise StatementImportError("Upload a valid PDF document.") from exc

    page_count = len(reader.pages)
    warnings: list[str] = []
    if page_count == 0:
        raise StatementImportError("The uploaded PDF does not contain any pages.")

    empty_pages = 0
    pages: list[str] = []
    for page in reader.pages:
        text = (page.extract_text() or "").replace("\xa0", " ").strip()
        if text:
            pages.append(text)
        else:
            empty_pages += 1

    if empty_pages:
        warnings.append(
            f"{empty_pages} page{'s' if empty_pages != 1 else ''} had no extractable text and were skipped."
        )

    document_text = "\n".join(pages).strip()
    if len(document_text) < 30:
        raise StatementImportError(
            "This PDF appears to be image-only or unsupported. Upload a text-based statement export."
        )

    return document_text, page_count, warnings


def parse_statement_transactions(
    document_text: str,
    reference_year: int,
    reference_date: date,
) -> list[StatementTransaction]:
    transactions: list[StatementTransaction] = []
    for raw_line in document_text.splitlines():
        line = " ".join(raw_line.strip().split())
        if len(line) < 10:
            continue

        parsed_date = parse_line_date(line, reference_year, reference_date)
        if parsed_date is None:
            continue

        remainder = line[parsed_date.end :].strip(" -•")
        amount_matches = list(AMOUNT_PATTERN.finditer(remainder))
        if not amount_matches:
            continue

        amount_match = choose_amount_match(amount_matches)
        description = remainder[: amount_match.start()].strip(" -*")
        if not description or should_skip_description(description):
            continue

        amount_token = amount_match.group(0)
        amount = parse_amount_token(amount_token)
        merchant = prettify_vendor(normalize_merchant_name(description) or description)
        transaction_hash = sha1(
            f"{parsed_date.value.isoformat()}|{merchant}|{amount:.2f}|{line}".encode("utf-8")
        ).hexdigest()[:16]
        transactions.append(
            StatementTransaction(
                transaction_id=transaction_hash,
                posted_on=parsed_date.value,
                description=description,
                merchant=merchant,
                amount=round(abs(amount), 2),
                currency=infer_currency(amount_token),
                raw_line=line,
            )
        )

    unique: dict[str, StatementTransaction] = {}
    for item in transactions:
        unique[item.transaction_id] = item
    return sorted(unique.values(), key=lambda item: (item.posted_on, item.merchant, item.amount))


def parse_line_date(
    line: str,
    reference_year: int,
    reference_date: date,
) -> ParsedDate | None:
    iso_match = DATE_PATTERNS[0].match(line)
    if iso_match:
        year, month, day = map(int, iso_match.groups())
        return ParsedDate(date(year, month, day), iso_match.end())

    slash_match = DATE_PATTERNS[1].match(line)
    if slash_match:
        month = int(slash_match.group(1))
        day = int(slash_match.group(2))
        year_token = slash_match.group(3)
        if year_token:
            year = normalize_year(int(year_token))
        else:
            year = reference_year
            candidate = date(year, month, day)
            if candidate > reference_date + timedelta(days=35):
                year -= 1
            elif candidate < reference_date - timedelta(days=400):
                year += 1
        return ParsedDate(date(year, month, day), slash_match.end())

    month_name_match = DATE_PATTERNS[2].match(line)
    if month_name_match:
        month = MONTH_LOOKUP.get(month_name_match.group(1)[:3].lower())
        if month is None:
            return None
        day = int(month_name_match.group(2))
        year_token = month_name_match.group(3)
        year = normalize_year(int(year_token)) if year_token else reference_year
        candidate = date(year, month, day)
        if not year_token and candidate > reference_date + timedelta(days=35):
            candidate = date(year - 1, month, day)
        return ParsedDate(candidate, month_name_match.end())

    return None


def normalize_year(year: int) -> int:
    if year < 100:
        return 2000 + year
    return year


def detect_reference_year(document_text: str, fallback: int) -> int:
    matches = [int(match) for match in re.findall(r"\b20\d{2}\b", document_text)]
    if not matches:
        return fallback
    return Counter(matches).most_common(1)[0][0]


def choose_amount_match(matches: list[re.Match[str]]) -> re.Match[str]:
    negative = [match for match in matches if "(" in match.group(0) or "-" in match.group(0)]
    if negative:
        return negative[0]
    return matches[0]


def parse_amount_token(token: str) -> float:
    normalized = (
        token.replace("USD", "")
        .replace("EUR", "")
        .replace("GBP", "")
        .replace("AUD", "")
        .replace("CAD", "")
        .replace("$", "")
        .replace("€", "")
        .replace("£", "")
        .replace(",", "")
        .strip()
    )
    sign = -1 if normalized.startswith("-") or normalized.startswith("(") else 1
    normalized = normalized.strip("-() ")
    return sign * float(normalized)


def infer_currency(token: str) -> str:
    stripped = token.strip()
    for symbol, currency in CURRENCY_SYMBOLS.items():
        if symbol in stripped:
            return currency
    for code in ("USD", "EUR", "GBP", "AUD", "CAD"):
        if code in stripped:
            return code
    return "USD"


def should_skip_description(description: str) -> bool:
    lowered = description.lower()
    if any(hint in lowered for hint in SKIP_DESCRIPTION_HINTS):
        return True
    return any(hint in lowered for hint in CREDIT_DESCRIPTION_HINTS)


def normalize_merchant_name(description: str) -> str:
    cleaned = description.upper().replace("&", " AND ")
    cleaned = re.sub(r"https?://\S+", " ", cleaned)
    cleaned = re.sub(r"\b\d{4,}\b", " ", cleaned)
    tokens = re.split(r"[^A-Z0-9]+", cleaned)
    meaningful = [
        token
        for token in tokens
        if token
        and token not in MERCHANT_NOISE
        and not token.isdigit()
        and len(token) > 1
    ]
    return " ".join(meaningful[:4])


def prettify_vendor(value: str) -> str:
    return " ".join(part.capitalize() for part in value.split()) or value.title()


def detect_recurring_candidates(
    transactions: list[StatementTransaction],
    *,
    existing_subscriptions: list[Subscription],
    reference_date: date,
) -> list[RecurringTransactionCandidate]:
    vendor_groups: dict[tuple[str, str], list[StatementTransaction]] = defaultdict(list)
    for item in transactions:
        normalized_vendor = normalize_merchant_name(item.description)
        if not normalized_vendor:
            continue
        vendor_groups[(normalized_vendor, item.currency)].append(item)

    candidates: list[RecurringTransactionCandidate] = []
    for (normalized_vendor, currency), group in vendor_groups.items():
        for clustered in cluster_transactions_by_amount(group):
            unique_dates = sorted({item.posted_on for item in clustered})
            if len(unique_dates) < 2:
                continue

            cadence_guess = guess_cadence(unique_dates, reference_date)
            if cadence_guess is None:
                continue

            amounts = [item.amount for item in clustered]
            amount_score, variable_amount = amount_consistency_score(amounts)
            confidence = score_candidate(
                cadence_score=cadence_guess.score,
                amount_score=amount_score,
                occurrences=len(unique_dates),
            )
            if confidence < 0.52:
                continue

            vendor = prettify_vendor(normalized_vendor)
            match = find_matching_subscription(
                normalized_vendor=normalized_vendor,
                currency=currency,
                amount=amounts[-1],
                cadence=cadence_guess.cadence,
                subscriptions=existing_subscriptions,
            )
            review_state = (
                CandidateReviewState.MATCHED if match is not None else CandidateReviewState.READY
            )
            candidate = RecurringTransactionCandidate(
                candidate_id=sha1(
                    f"{normalized_vendor}|{currency}|{unique_dates[0].isoformat()}|{len(unique_dates)}".encode(
                        "utf-8"
                    )
                ).hexdigest()[:16],
                name=vendor,
                vendor=vendor,
                normalized_vendor=normalized_vendor,
                cadence=cadence_guess.cadence,
                review_state=review_state,
                confidence=round(confidence, 2),
                confidence_label=confidence_label(confidence),
                average_amount=round(fmean(amounts), 2),
                latest_amount=round(clustered[-1].amount, 2),
                currency=currency,
                occurrence_count=len(unique_dates),
                first_seen_on=unique_dates[0],
                last_seen_on=unique_dates[-1],
                next_expected_on=cadence_guess.next_expected_on,
                suggested_day_of_month=cadence_guess.suggested_day_of_month,
                suggested_status=suggest_status(unique_dates[-1], cadence_guess.cadence, reference_date),
                variable_amount=variable_amount,
                matched_subscription_id=match.id if match else None,
                matched_subscription_name=match.name if match else None,
                notes=build_candidate_note(
                    cadence_guess=cadence_guess,
                    amount_score=amount_score,
                    variable_amount=variable_amount,
                    occurrence_count=len(unique_dates),
                ),
                source_transaction_ids=[item.transaction_id for item in clustered],
            )
            candidates.append(candidate)

    return sorted(
        candidates,
        key=lambda item: (
            item.review_state == CandidateReviewState.READY,
            item.confidence,
            item.latest_amount,
        ),
        reverse=True,
    )


def cluster_transactions_by_amount(
    transactions: list[StatementTransaction],
) -> list[list[StatementTransaction]]:
    ordered = sorted(transactions, key=lambda item: item.amount)
    clusters: list[list[StatementTransaction]] = []

    for item in ordered:
        placed = False
        for cluster in clusters:
            mean_amount = fmean(candidate.amount for candidate in cluster)
            if math.isclose(item.amount, mean_amount, rel_tol=0.22, abs_tol=3.0):
                cluster.append(item)
                placed = True
                break
        if not placed:
            clusters.append([item])

    return [sorted(cluster, key=lambda item: item.posted_on) for cluster in clusters]


def guess_cadence(dates: list[date], reference_date: date) -> CadenceGuess | None:
    intervals = [(right - left).days for left, right in zip(dates, dates[1:])]
    if not intervals:
        return None

    monthly_guess = score_monthly(dates, intervals)
    weekly_guess = score_weekly(dates, intervals)
    yearly_guess = score_yearly(dates, intervals)

    candidates = [guess for guess in (weekly_guess, monthly_guess, yearly_guess) if guess is not None]
    if not candidates:
        return None

    best = max(candidates, key=lambda item: item.score)
    if best.cadence == Cadence.WEEKLY:
        return best
    if best.cadence == Cadence.MONTHLY and best.next_expected_on <= reference_date + timedelta(days=62):
        return best
    if best.cadence == Cadence.YEARLY:
        return best
    return best


def score_weekly(dates: list[date], intervals: list[int]) -> CadenceGuess | None:
    deviations = [abs(interval - 7) for interval in intervals]
    if any(deviation > 2 for deviation in deviations):
        return None
    score = 1 - (sum(deviations) / max(len(intervals), 1)) / 6
    return CadenceGuess(
        cadence=Cadence.WEEKLY,
        score=max(0.6, min(score, 0.98)),
        next_expected_on=dates[-1] + timedelta(days=7),
        suggested_day_of_month=None,
    )


def score_monthly(dates: list[date], intervals: list[int]) -> CadenceGuess | None:
    valid_intervals = [27 <= interval <= 35 or 55 <= interval <= 63 for interval in intervals]
    if not all(valid_intervals):
        return None

    anchor_days = [item.day for item in dates]
    spread = max(anchor_days) - min(anchor_days)
    average_interval = sum(intervals) / len(intervals)
    score = 0.72
    if spread <= 3:
        score += 0.16
    if average_interval <= 33:
        score += 0.06

    next_month = dates[-1].month + 1
    next_year = dates[-1].year
    if next_month == 13:
        next_month = 1
        next_year += 1
    anchor = round(sum(anchor_days) / len(anchor_days))
    next_expected = date(next_year, next_month, min(anchor, last_day_of_month(next_year, next_month)))
    return CadenceGuess(
        cadence=Cadence.MONTHLY,
        score=min(score, 0.97),
        next_expected_on=next_expected,
        suggested_day_of_month=anchor,
    )


def score_yearly(dates: list[date], intervals: list[int]) -> CadenceGuess | None:
    if not all(330 <= interval <= 390 for interval in intervals):
        return None

    next_year = dates[-1].year + 1
    next_expected = date(
        next_year,
        dates[-1].month,
        min(dates[-1].day, last_day_of_month(next_year, dates[-1].month)),
    )
    return CadenceGuess(
        cadence=Cadence.YEARLY,
        score=0.8,
        next_expected_on=next_expected,
        suggested_day_of_month=None,
    )


def last_day_of_month(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (date(year, month + 1, 1) - timedelta(days=1)).day


def amount_consistency_score(amounts: list[float]) -> tuple[float, bool]:
    average = fmean(amounts)
    if average <= 0:
        return 0, False

    max_delta_ratio = max(abs(amount - average) / average for amount in amounts)
    if max_delta_ratio <= 0.03:
        return 0.98, False
    if max_delta_ratio <= 0.1:
        return 0.88, True
    if max_delta_ratio <= 0.2:
        return 0.72, True
    if max_delta_ratio <= 0.35:
        return 0.55, True
    return 0.3, True


def score_candidate(cadence_score: float, amount_score: float, occurrences: int) -> float:
    occurrence_bonus = min(0.12, max(0, occurrences - 2) * 0.04)
    return min(0.98, cadence_score * 0.65 + amount_score * 0.35 + occurrence_bonus)


def confidence_label(confidence: float) -> CandidateConfidenceLabel:
    if confidence >= 0.85:
        return CandidateConfidenceLabel.HIGH
    if confidence >= 0.68:
        return CandidateConfidenceLabel.MEDIUM
    return CandidateConfidenceLabel.LOW


def suggest_status(last_seen: date, cadence: Cadence, reference_date: date) -> SubscriptionStatus:
    if cadence == Cadence.WEEKLY:
        threshold = timedelta(days=16)
    elif cadence == Cadence.MONTHLY:
        threshold = timedelta(days=45)
    else:
        threshold = timedelta(days=400)
    if reference_date - last_seen > threshold:
        return SubscriptionStatus.PAUSED
    return SubscriptionStatus.ACTIVE


def build_candidate_note(
    *,
    cadence_guess: CadenceGuess,
    amount_score: float,
    variable_amount: bool,
    occurrence_count: int,
) -> str:
    cadence_part = f"{occurrence_count} {cadence_guess.cadence.value} charge matches"
    amount_part = "variable amounts observed" if variable_amount else "stable amount pattern"
    confidence_part = "high confidence" if amount_score >= 0.85 else "review before importing"
    return f"{cadence_part}; {amount_part}; {confidence_part}."


def monthly_equivalent(amount: float, cadence: Cadence) -> float:
    if cadence == Cadence.WEEKLY:
        return (amount * 52) / 12
    if cadence == Cadence.YEARLY:
        return amount / 12
    return amount


def find_matching_subscription(
    *,
    normalized_vendor: str,
    currency: str,
    amount: float,
    cadence: Cadence,
    subscriptions: list[Subscription],
) -> Subscription | None:
    best_match: tuple[float, Subscription] | None = None

    for subscription in subscriptions:
        if subscription.currency.upper() != currency.upper():
            continue

        vendor_similarity = max(
            similarity(normalized_vendor, normalize_merchant_name(subscription.vendor)),
            similarity(normalized_vendor, normalize_merchant_name(subscription.name)),
        )
        if vendor_similarity < 0.55:
            continue

        amount_similarity = 1 - min(
            abs(subscription.amount - amount) / max(subscription.amount, amount, 1),
            1,
        )
        cadence_bonus = 0.08 if subscription.cadence == cadence else 0
        score = vendor_similarity * 0.72 + amount_similarity * 0.2 + cadence_bonus

        if best_match is None or score > best_match[0]:
            best_match = (score, subscription)

    if best_match is None or best_match[0] < 0.62:
        return None
    return best_match[1]


def similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0
    if left == right or left in right or right in left:
        return 1

    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return 0
    return len(left_tokens & right_tokens) / max(len(left_tokens), len(right_tokens))
