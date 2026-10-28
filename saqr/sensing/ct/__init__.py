"""Certificate Transparency sources. All of them yield CertEntry objects through an async iterator."""
from __future__ import annotations

from typing import AsyncIterator, Protocol

from ...models import CertEntry


class CertSource(Protocol):
    name: str

    def stream(self) -> AsyncIterator[CertEntry]: ...

    def stats(self) -> dict: ...
