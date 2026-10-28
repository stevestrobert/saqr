"""Append-only, hash-chained audit log.

hash_n = sha256(prev_hash || canonical_json({at, actor, action, subject, detail}))
Any edit or deletion of an earlier row breaks every later hash; `verify()` walks the chain.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from ..db import Store
from ..models import AuditEntry

GENESIS = "0" * 64


def _hash(prev_hash: str, at: datetime, actor: str, action: str, subject: str, detail: dict) -> str:
    body = json.dumps({"at": at.isoformat(), "actor": actor, "action": action, "subject": subject, "detail": detail},
                      sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256((prev_hash + body).encode()).hexdigest()


class AuditLog:
    def __init__(self, store: Store, on_entry=None) -> None:
        self.store = store
        self.on_entry = on_entry

    def record(self, actor: str, action: str, subject: str, **detail: Any) -> AuditEntry:
        last = self.store.audit_last()
        prev = last.hash if last else GENESIS
        at = datetime.now(timezone.utc)
        detail = json.loads(json.dumps(detail, default=str))
        entry = self.store.audit_append(at, actor, action, subject, detail, prev, _hash(prev, at, actor, action, subject, detail))
        if self.on_entry:
            try:
                self.on_entry(entry)
            except Exception:
                pass
        return entry

    def verify(self) -> dict[str, Any]:
        entries = self.store.audit_all()
        prev = GENESIS
        for e in entries:
            if e.prev_hash != prev or _hash(prev, e.at, e.actor, e.action, e.subject, e.detail) != e.hash:
                return {"valid": False, "length": len(entries), "broken_at": e.seq}
            prev = e.hash
        return {"valid": True, "length": len(entries), "broken_at": None}
