from __future__ import annotations

from uuid import UUID

from subtracker_api.models.imports import StatementImportReport


class MemoryStatementImportRepository:
    def __init__(self) -> None:
        self._items: dict[UUID, StatementImportReport] = {}
        self._latest_id: UUID | None = None

    def get(self, report_id: UUID) -> StatementImportReport | None:
        return self._items.get(report_id)

    def latest(self) -> StatementImportReport | None:
        if self._latest_id is None:
            return None
        return self._items.get(self._latest_id)

    def save(self, report: StatementImportReport) -> StatementImportReport:
        self._items[report.id] = report
        self._latest_id = report.id
        return report
