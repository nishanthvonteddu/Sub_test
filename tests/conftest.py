from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from subtracker_api.main import create_app


def get_client() -> Generator[TestClient, None, None]:
    app = create_app()
    with TestClient(app) as client:
        yield client

@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    yield from get_client()
