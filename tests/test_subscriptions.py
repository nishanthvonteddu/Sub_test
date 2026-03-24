from datetime import date

from fastapi.testclient import TestClient


def test_create_and_list_subscription(client: TestClient) -> None:
    payload = {
        "name": "Netflix",
        "vendor": "Netflix",
        "amount": 19.99,
        "currency": "USD",
        "cadence": "monthly",
        "start_date": "2026-03-01",
        "day_of_month": 1,
    }

    create_response = client.post("/subscriptions", json=payload)
    assert create_response.status_code == 201

    item = create_response.json()
    assert item["name"] == "Netflix"
    assert item["next_charge_date"] >= date.today().isoformat()
    assert item["end_date"] is None

    list_response = client.get("/subscriptions")
    assert list_response.status_code == 200
    data = list_response.json()
    assert len(data) == 1
    assert data[0]["vendor"] == "Netflix"


def test_canceled_subscription_has_no_next_charge(client: TestClient) -> None:
    payload = {
        "name": "Gym Membership",
        "vendor": "Peak Club",
        "amount": 44.0,
        "currency": "USD",
        "cadence": "monthly",
        "status": "canceled",
        "start_date": "2025-01-10",
        "end_date": "2026-03-31",
        "day_of_month": 10,
    }

    create_response = client.post("/subscriptions", json=payload)
    assert create_response.status_code == 201

    item = create_response.json()
    assert item["status"] == "canceled"
    assert item["end_date"] == "2026-03-31"
    assert item["next_charge_date"] is None


def test_get_subscription_next_charge(client: TestClient) -> None:
    payload = {
        "name": "Cloud Backup",
        "vendor": "Acme",
        "amount": 10.0,
        "currency": "USD",
        "cadence": "yearly",
        "start_date": "2025-02-15",
    }
    create_response = client.post("/subscriptions", json=payload)
    subscription_id = create_response.json()["id"]

    response = client.get(f"/subscriptions/{subscription_id}/next-charge")
    assert response.status_code == 200
    body = response.json()
    assert body["subscription_id"] == subscription_id
    assert isinstance(body["next_charge_date"], str)


def test_rejects_end_date_before_start_date(client: TestClient) -> None:
    payload = {
        "name": "Design Suite",
        "vendor": "Adobe",
        "amount": 54.99,
        "currency": "USD",
        "cadence": "monthly",
        "start_date": "2026-03-10",
        "end_date": "2026-03-01",
    }

    response = client.post("/subscriptions", json=payload)
    assert response.status_code == 422
