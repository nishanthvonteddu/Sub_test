from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from subtracker_api.api.deps import get_subscription_repo
from subtracker_api.models.subscription import (
    Subscription,
    SubscriptionCreate,
    SubscriptionStatusUpdate,
)
from subtracker_api.repositories.memory_subscription_repo import MemorySubscriptionRepository
from subtracker_api.services.billing import calculate_next_charge

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


@router.get("", response_model=list[Subscription])
def list_subscriptions(
    repo: MemorySubscriptionRepository = Depends(get_subscription_repo),
) -> list[Subscription]:
    return repo.list()


@router.post("", response_model=Subscription, status_code=status.HTTP_201_CREATED)
def create_subscription(
    payload: SubscriptionCreate,
    repo: MemorySubscriptionRepository = Depends(get_subscription_repo),
) -> Subscription:
    item = Subscription(
        **payload.model_dump(),
        next_charge_date=calculate_next_charge(payload),
    )
    return repo.add(item)


@router.get("/{subscription_id}", response_model=Subscription)
def get_subscription(
    subscription_id: UUID,
    repo: MemorySubscriptionRepository = Depends(get_subscription_repo),
) -> Subscription:
    item = repo.get(subscription_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscription not found")
    return item


@router.get("/{subscription_id}/next-charge")
def get_next_charge(
    subscription_id: UUID,
    repo: MemorySubscriptionRepository = Depends(get_subscription_repo),
) -> dict[str, str | None]:
    item = repo.get(subscription_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscription not found")
    return {
        "subscription_id": str(item.id),
        "next_charge_date": item.next_charge_date.isoformat() if item.next_charge_date else None,
    }


@router.put("/{subscription_id}", response_model=Subscription)
def update_subscription(
    subscription_id: UUID,
    payload: SubscriptionCreate,
    repo: MemorySubscriptionRepository = Depends(get_subscription_repo),
) -> Subscription:
    existing = repo.get(subscription_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscription not found")

    updated = Subscription(
        id=existing.id,
        created_at=existing.created_at,
        **payload.model_dump(),
        next_charge_date=calculate_next_charge(payload),
    )
    return repo.update(updated)


@router.patch("/{subscription_id}/status", response_model=Subscription)
def update_subscription_status(
    subscription_id: UUID,
    payload: SubscriptionStatusUpdate,
    repo: MemorySubscriptionRepository = Depends(get_subscription_repo),
) -> Subscription:
    existing = repo.get(subscription_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscription not found")

    next_payload = SubscriptionCreate(
        name=existing.name,
        vendor=existing.vendor,
        amount=existing.amount,
        currency=existing.currency,
        cadence=existing.cadence,
        status=payload.status,
        start_date=existing.start_date,
        end_date=existing.end_date,
        day_of_month=existing.day_of_month,
        notes=existing.notes,
    )
    updated = Subscription(
        id=existing.id,
        created_at=existing.created_at,
        **next_payload.model_dump(),
        next_charge_date=calculate_next_charge(next_payload),
    )
    return repo.update(updated)
