from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from subtracker_api.api.deps import get_subscription_repo
from subtracker_api.models.subscription import Subscription, SubscriptionCreate
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
