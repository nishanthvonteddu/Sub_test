from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from subtracker_api.models.subscription import Subscription


class MemorySubscriptionRepository:
    def __init__(self) -> None:
        self._items: dict[UUID, Subscription] = {}

    def list(self) -> list[Subscription]:
        return sorted(self._items.values(), key=lambda item: item.created_at, reverse=True)

    def get(self, subscription_id: UUID) -> Subscription | None:
        return self._items.get(subscription_id)

    def add(self, item: Subscription) -> Subscription:
        self._items[item.id] = item
        return item

    def update(self, item: Subscription) -> Subscription:
        self._items[item.id] = item
        return item

    def delete(self, subscription_id: UUID) -> Subscription | None:
        return self._items.pop(subscription_id, None)

    def extend(self, items: Iterable[Subscription]) -> None:
        for item in items:
            self._items[item.id] = item
