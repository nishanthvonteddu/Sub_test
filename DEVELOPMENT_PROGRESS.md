# Development Progress


## Status

- Project: `Subscription Tracker`
- Stage: `MVP skeleton`
- Last updated: 2026-03-18

## Completed

- Repository bootstrapped with Python 3.12 metadata.
- `uv`-ready dependency setup in `pyproject.toml`.
- FastAPI app skeleton created.
- In-memory subscription repository implemented.
- Basic billing logic for next-charge calculation added.
- Health and subscription API routes added.
- Initial pytest suite added.
- Lint/type configs added (`ruff`, `pyright`).

## In Progress

- Stabilizing recurrence logic with more edge-case tests.

## Next (Short-Term)

- Add persistent data layer (PostgreSQL + SQLAlchemy + Alembic).
- Introduce service/repository interfaces for clean swapping.
- Add update/delete endpoints and idempotency keys.
- Add request logging middleware and error contract standardization.

## Risks / Notes

- In-memory storage is non-persistent and single-process only.
- Current billing logic is intentionally simple and should be expanded for full timezone/DST rigor.

