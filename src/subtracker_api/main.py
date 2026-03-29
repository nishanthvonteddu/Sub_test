from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from subtracker_api.api.routes import health, statement_imports, subscriptions
from subtracker_api.core.config import settings
from subtracker_api.repositories.memory_statement_import_repo import MemoryStatementImportRepository
from subtracker_api.repositories.memory_subscription_repo import MemorySubscriptionRepository


def create_app() -> FastAPI:
    web_dir = Path(__file__).parent / "web"
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="MVP API for tracking subscriptions and recurring charges.",
    )
    app.state.subscription_repo = MemorySubscriptionRepository()
    app.state.statement_import_repo = MemoryStatementImportRepository()
    app.mount("/static", StaticFiles(directory=web_dir), name="static")

    @app.get("/", include_in_schema=False)
    def marketing_page() -> FileResponse:
        return FileResponse(web_dir / "index.html")

    @app.get("/app", include_in_schema=False)
    def dashboard_page() -> FileResponse:
        return FileResponse(web_dir / "dashboard.html")

    @app.get("/login", include_in_schema=False)
    def login_page() -> FileResponse:
        return FileResponse(web_dir / "auth.html")

    app.include_router(health.router)
    app.include_router(subscriptions.router)
    app.include_router(statement_imports.router)
    return app


app = create_app()
