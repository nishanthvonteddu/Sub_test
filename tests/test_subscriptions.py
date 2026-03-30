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


def test_update_subscription_reuses_existing_record(client: TestClient) -> None:
    create_response = client.post(
        "/subscriptions",
        json={
            "name": "Netflix",
            "vendor": "Netflix",
            "amount": 19.99,
            "currency": "USD",
            "cadence": "monthly",
            "start_date": "2026-03-01",
            "day_of_month": 1,
            "notes": "Original plan",
        },
    )
    created = create_response.json()

    update_response = client.put(
        f"/subscriptions/{created['id']}",
        json={
            "name": "Netflix Premium",
            "vendor": "Netflix",
            "amount": 24.99,
            "currency": "USD",
            "cadence": "monthly",
            "status": "paused",
            "start_date": "2026-03-01",
            "day_of_month": 15,
            "notes": "Updated plan",
        },
    )
    assert update_response.status_code == 200

    updated = update_response.json()
    assert updated["id"] == created["id"]
    assert updated["created_at"] == created["created_at"]
    assert updated["name"] == "Netflix Premium"
    assert updated["amount"] == 24.99
    assert updated["status"] == "paused"
    assert updated["day_of_month"] == 15
    assert updated["notes"] == "Updated plan"
    assert updated["next_charge_date"] is None

    list_response = client.get("/subscriptions")
    assert list_response.status_code == 200
    data = list_response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Netflix Premium"


def test_update_subscription_status_recalculates_next_charge(client: TestClient) -> None:
    create_response = client.post(
        "/subscriptions",
        json={
            "name": "Music Box",
            "vendor": "Music Box",
            "amount": 8.99,
            "currency": "USD",
            "cadence": "monthly",
            "start_date": "2026-03-04",
            "day_of_month": 4,
        },
    )
    created = create_response.json()

    pause_response = client.patch(
        f"/subscriptions/{created['id']}/status",
        json={"status": "paused"},
    )
    assert pause_response.status_code == 200
    paused = pause_response.json()
    assert paused["status"] == "paused"
    assert paused["next_charge_date"] is None

    resume_response = client.patch(
        f"/subscriptions/{created['id']}/status",
        json={"status": "active"},
    )
    assert resume_response.status_code == 200
    resumed = resume_response.json()
    assert resumed["status"] == "active"
    assert resumed["next_charge_date"] >= date.today().isoformat()


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
