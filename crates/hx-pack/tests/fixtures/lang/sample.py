"""Sample module for outline tests."""

import functools


def top_level(a, b=2):
    def inner():
        return a

    return inner() + b


@functools.lru_cache(maxsize=None)
def cached(n: int) -> int:
    return n * 2


# A documented class.
class Account:
    """A bank account."""

    def __init__(self, owner: str) -> None:
        self.owner = owner

    @property
    def label(self) -> str:
        return self.owner

    async def deposit(
        self,
        amount: int,
    ) -> None:
        pass

    class Meta:
        table = "accounts"
