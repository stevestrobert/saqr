"""In-process event bus: pipeline components publish, WebSocket clients subscribe.

Events are small JSON-serialisable dicts: {"type": ..., "at": iso-time, "data": {...}}.
A bounded history lets a dashboard that connects late replay the last few hundred events.
"""
from __future__ import annotations

import asyncio
import json
from collections import deque
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel


def _jsonable(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return json.loads(value.model_dump_json())
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


class EventBus:
    def __init__(self, history: int = 300) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self.history: deque[dict] = deque(maxlen=history)
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self, maxsize: int = 1000) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def publish(self, type_: str, data: Any = None, keep: bool = True) -> dict:
        event = {"type": type_, "at": datetime.now(timezone.utc).isoformat(), "data": _jsonable(data)}
        if keep:
            self.history.append(event)
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Slow consumer: drop the oldest to keep the live wall moving.
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except Exception:
                    pass
        return event

    def publish_threadsafe(self, type_: str, data: Any = None, keep: bool = True) -> None:
        """Publish from a worker thread."""
        if self._loop is None or self._loop.is_closed():
            self.publish(type_, data, keep)
            return
        self._loop.call_soon_threadsafe(self.publish, type_, data, keep)
