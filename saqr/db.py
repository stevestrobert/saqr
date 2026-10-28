"""SQLite-backed document store. Each model is stored as JSON with a few indexed columns.

A single-process MVP does not need an ORM; this keeps persistence small, inspectable (sqlite3 CLI) and
restart-safe. The audit table is append-only and hash-chained (see response/audit.py).
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, TypeVar

from pydantic import BaseModel

from .models import Action, AuditEntry, Campaign, Candidate, Case, CertEntry, EvidencePackage, Report

T = TypeVar("T", bound=BaseModel)

SCHEMA = """
CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, domain TEXT, status TEXT, created_at TEXT, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_candidates_domain ON candidates(domain);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, domain TEXT, state TEXT, created_at TEXT, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_cases_domain ON cases(domain);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, channel TEXT, created_at TEXT, campaign_id TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, created_at TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, case_id TEXT, status TEXT, created_at TEXT, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_actions_case ON actions(case_id);
CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, case_id TEXT, created_at TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS certs (id TEXT PRIMARY KEY, seen_at TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
    subject TEXT NOT NULL, detail TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

_TABLES: dict[type[BaseModel], str] = {
    Candidate: "candidates",
    Case: "cases",
    Report: "reports",
    Campaign: "campaigns",
    Action: "actions",
    EvidencePackage: "evidence",
    CertEntry: "certs",
}


def _dump(model: BaseModel) -> str:
    return model.model_dump_json()


class Store:
    def __init__(self, path: Path | str = ":memory:") -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._lock = threading.RLock()
        with self._lock:
            self._conn.executescript(SCHEMA)

    # ------------------------------------------------------------------------------- generic helpers
    def _index_cols(self, model: BaseModel) -> dict[str, Any]:
        if isinstance(model, Candidate):
            return {"domain": model.domain, "status": model.status.value, "created_at": model.first_seen.isoformat()}
        if isinstance(model, Case):
            return {"domain": model.domain, "state": model.state.value, "created_at": model.created_at.isoformat()}
        if isinstance(model, Report):
            return {"channel": model.channel, "created_at": model.received_at.isoformat(), "campaign_id": model.campaign_id}
        if isinstance(model, Campaign):
            return {"created_at": model.created_at.isoformat()}
        if isinstance(model, Action):
            return {"case_id": model.case_id, "status": model.status.value, "created_at": model.created_at.isoformat()}
        if isinstance(model, EvidencePackage):
            return {"case_id": model.case_id, "created_at": model.created_at.isoformat()}
        if isinstance(model, CertEntry):
            return {"seen_at": model.seen_at.isoformat()}
        return {}

    def put(self, model: BaseModel) -> None:
        table = _TABLES[type(model)]
        cols = self._index_cols(model)
        names = ["id", *cols.keys(), "json"]
        values = [model.id, *cols.values(), _dump(model)]
        placeholders = ",".join("?" for _ in names)
        sql = f"INSERT OR REPLACE INTO {table} ({','.join(names)}) VALUES ({placeholders})"
        with self._lock:
            self._conn.execute(sql, values)

    def get(self, model_type: type[T], id_: str) -> T | None:
        table = _TABLES[model_type]
        with self._lock:
            row = self._conn.execute(f"SELECT json FROM {table} WHERE id=?", (id_,)).fetchone()
        return model_type.model_validate_json(row[0]) if row else None

    def list(
        self,
        model_type: type[T],
        where: dict[str, Any] | None = None,
        order: str = "created_at DESC",
        limit: int | None = None,
    ) -> list[T]:
        table = _TABLES[model_type]
        sql = f"SELECT json FROM {table}"
        params: list[Any] = []
        if where:
            clauses = []
            for k, v in where.items():
                if isinstance(v, (list, tuple, set)):
                    clauses.append(f"{k} IN ({','.join('?' for _ in v)})")
                    params.extend(v)
                else:
                    clauses.append(f"{k}=?")
                    params.append(v)
            sql += " WHERE " + " AND ".join(clauses)
        if order:
            sql += f" ORDER BY {order}"
        if limit:
            sql += f" LIMIT {int(limit)}"
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        return [model_type.model_validate_json(r[0]) for r in rows]

    def count(self, model_type: type[BaseModel], where: dict[str, Any] | None = None) -> int:
        table = _TABLES[model_type]
        sql = f"SELECT COUNT(*) FROM {table}"
        params: list[Any] = []
        if where:
            sql += " WHERE " + " AND ".join(f"{k}=?" for k in where)
            params = list(where.values())
        with self._lock:
            return int(self._conn.execute(sql, params).fetchone()[0])

    def delete(self, model_type: type[BaseModel], id_: str) -> None:
        with self._lock:
            self._conn.execute(f"DELETE FROM {_TABLES[model_type]} WHERE id=?", (id_,))

    # ----------------------------------------------------------------------------------- lookups
    def candidate_by_domain(self, domain: str) -> Candidate | None:
        rows = self.list(Candidate, {"domain": domain}, order="created_at DESC", limit=1)
        return rows[0] if rows else None

    def case_by_domain(self, domain: str) -> Case | None:
        rows = self.list(Case, {"domain": domain}, order="created_at DESC", limit=1)
        return rows[0] if rows else None

    def actions_for_case(self, case_id: str) -> list[Action]:
        return self.list(Action, {"case_id": case_id}, order="created_at ASC")

    def evidence_for_case(self, case_id: str) -> EvidencePackage | None:
        rows = self.list(EvidencePackage, {"case_id": case_id}, limit=1)
        return rows[0] if rows else None

    def recent_certs(self, limit: int = 200) -> list[CertEntry]:
        return self.list(CertEntry, order="seen_at DESC", limit=limit)

    # -------------------------------------------------------------------------------------- kv
    def kv_get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            row = self._conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def kv_set(self, key: str, value: Any) -> None:
        with self._lock:
            self._conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (key, json.dumps(value)))

    # ------------------------------------------------------------------------------------ audit
    def audit_last(self) -> AuditEntry | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT seq, at, actor, action, subject, detail, prev_hash, hash FROM audit ORDER BY seq DESC LIMIT 1"
            ).fetchone()
        return self._audit_row(row) if row else None

    def audit_append(self, at: datetime, actor: str, action: str, subject: str, detail: dict, prev_hash: str, hash_: str) -> AuditEntry:
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO audit (at, actor, action, subject, detail, prev_hash, hash) VALUES (?,?,?,?,?,?,?)",
                (at.isoformat(), actor, action, subject, json.dumps(detail, sort_keys=True, default=str), prev_hash, hash_),
            )
            seq = cur.lastrowid
        return AuditEntry(seq=seq, at=at, actor=actor, action=action, subject=subject, detail=detail, prev_hash=prev_hash, hash=hash_)

    def audit_all(self, limit: int | None = None) -> list[AuditEntry]:
        sql = "SELECT seq, at, actor, action, subject, detail, prev_hash, hash FROM audit ORDER BY seq ASC"
        if limit:
            sql = f"SELECT * FROM ({sql.replace('ASC', 'DESC')} LIMIT {int(limit)}) ORDER BY seq ASC"
        with self._lock:
            rows = self._conn.execute(sql).fetchall()
        return [self._audit_row(r) for r in rows]

    @staticmethod
    def _audit_row(row: Iterable[Any]) -> AuditEntry:
        seq, at, actor, action, subject, detail, prev_hash, hash_ = row
        return AuditEntry(
            seq=seq, at=datetime.fromisoformat(at), actor=actor, action=action, subject=subject,
            detail=json.loads(detail), prev_hash=prev_hash, hash=hash_,
        )

    def close(self) -> None:
        with self._lock:
            self._conn.close()
