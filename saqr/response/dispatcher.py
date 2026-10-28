"""One-click response: approval -> safeguards -> fan-out to every connector -> receipts and acknowledgements.

Safeguards enforced here, not in the UI:
  1. The domain must not be an official property (whitelist re-checked at dispatch time, independent of the verdict).
  2. A named human must approve; the approval is written to the hash-chained audit log before anything is sent.
  3. Only cases with a suspicious/confirmed verdict can be dispatched; benign and inactive cases are refused.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Awaitable, Callable

from ..db import Store
from ..models import Action, ActionStatus, Case, CaseState, Channel, EvidencePackage, VerdictLabel
from ..sensing.protected import Registry
from .audit import AuditLog
from .connectors import Connector, connectors_for

log = logging.getLogger(__name__)


class DispatchRefused(Exception):
    pass


class Dispatcher:
    def __init__(self, store: Store, registry: Registry, audit: AuditLog, *, mode: str = "simulate", ack_scale: float = 1.0,
                 on_action: Callable[[Action], None] | None = None, on_case: Callable[[Case], Awaitable[None] | None] | None = None) -> None:
        self.store = store
        self.registry = registry
        self.audit = audit
        self.mode = mode
        self.ack_scale = ack_scale
        self.on_action = on_action or (lambda a: None)
        self.on_case = on_case
        self._tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------------------------------------ safeguards
    def check(self, case: Case, actor: str) -> None:
        if not actor or not actor.strip():
            raise DispatchRefused("an analyst identity is required to approve a block")
        if self.registry.is_allowlisted(case.domain):
            raise DispatchRefused(f"{case.domain} is an official government property (allow-listed) and can never be blocked")
        if case.verdict.label not in (VerdictLabel.confirmed_fake, VerdictLabel.suspicious):
            raise DispatchRefused(f"verdict '{case.verdict.label.value}' does not justify blocking; re-verify first")
        if case.state not in (CaseState.open, CaseState.monitoring):
            raise DispatchRefused(f"case is already {case.state.value}")

    # ---------------------------------------------------------------------------------------------- approve
    async def approve_and_dispatch(self, case: Case, pkg: EvidencePackage | None, actor: str, channels: list[Channel] | None = None,
                                   note: str = "") -> list[Action]:
        self.check(case, actor)
        now = datetime.now(timezone.utc)
        case.state = CaseState.approved
        case.approved_at, case.approved_by = now, actor
        if note:
            case.analyst_note = note
        case.add_event("approved", "Analyst approved takedown & block", f"{actor}: {note}" if note else actor, actor=actor, at=now)
        self.store.put(case)
        self.audit.record(actor, "case.approve", case.id, domain=case.domain, risk=case.verdict.risk, verdict=case.verdict.label.value,
                          safeguards={"allowlisted": False, "human_approval": True}, channels=[c.value for c in channels] if channels else "all", note=note)

        actions: list[Action] = []
        for conn in connectors_for(channels):
            for target in conn.targets(case, pkg):
                a = Action(case_id=case.id, channel=conn.channel, connector=conn.__class__.__name__, target=target.name,
                           request_summary=conn.summary(case, target), payload=conn.payload(case, pkg, target),
                           blocks_exposure=conn.blocks_exposure)
                self.store.put(a)
                actions.append(a)
                self.on_action(a)
        case.add_event("dispatched", f"Requests sent to {len(actions)} partner endpoints", ", ".join(sorted({a.channel.value for a in actions})), at=now)
        self.store.put(case)
        await self._notify_case(case)
        # fan out concurrently
        await asyncio.gather(*(self._send(conn, a) for conn in connectors_for(channels) for a in actions if a.connector == conn.__class__.__name__))
        return actions

    async def _send(self, conn: Connector, action: Action) -> None:
        try:
            receipt = await conn.send(action, self.mode)
        except Exception as exc:
            action.status, action.error = ActionStatus.failed, f"{type(exc).__name__}: {exc}"
            self.store.put(action)
            self.on_action(action)
            return
        action.sent_at = datetime.now(timezone.utc)
        action.receipt = receipt.receipt_id
        if not receipt.accepted:
            action.status, action.error = ActionStatus.failed, receipt.message
            self.store.put(action)
            self.on_action(action)
            self.audit.record("system", "action.failed", action.id, case=action.case_id, channel=action.channel.value, target=action.target, error=receipt.message)
            return
        action.status = ActionStatus.sent
        self.store.put(action)
        self.on_action(action)
        self.audit.record("system", "action.sent", action.id, case=action.case_id, channel=action.channel.value, target=action.target,
                          receipt=receipt.receipt_id, request=action.request_summary)
        t = asyncio.create_task(self._follow_up(action, receipt))
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    def cancel_follow_ups(self) -> None:
        """Stop pending simulated acknowledgements (shutdown, demo reset)."""
        for t in list(self._tasks):
            t.cancel()
        self._tasks.clear()

    def _still_exists(self, action: Action) -> bool:
        return self.store.get(Action, action.id) is not None

    async def _follow_up(self, action: Action, receipt) -> None:
        """Simulated partner acknowledgement and completion (in live mode these arrive via webhooks / mailbox polling)."""
        await asyncio.sleep(receipt.ack_delay_s * self.ack_scale)
        if not self._still_exists(action):
            return  # the case was wiped (demo reset) while the partner was "thinking"
        action.status, action.acknowledged_at = ActionStatus.acknowledged, datetime.now(timezone.utc)
        self.store.put(action)
        self.on_action(action)
        if receipt.blocks_exposure:
            await self._mark_blocked(action)
        if receipt.completes:
            await asyncio.sleep(receipt.completion_delay_s * self.ack_scale)
            if not self._still_exists(action):
                return
            action.status, action.completed_at = ActionStatus.completed, datetime.now(timezone.utc)
            self.store.put(action)
            self.on_action(action)
            self.audit.record("partner", "action.completed", action.id, case=action.case_id, channel=action.channel.value, target=action.target)
            if action.channel in (Channel.registrar, Channel.hosting):
                await self._mark_taken_down(action)

    async def _mark_blocked(self, action: Action) -> None:
        case = self.store.get(Case, action.case_id)
        if not case:
            return
        if case.blocked_at is None:
            case.blocked_at = action.acknowledged_at
            case.state = CaseState.blocked
            case.add_event("blocked", "Victims can no longer reach the page", f"{action.target} confirmed the block", actor="partner", at=case.blocked_at)
            self.store.put(case)
            self.audit.record("partner", "case.blocked", case.id, channel=action.channel.value, target=action.target, blocked_at=case.blocked_at)
            await self._notify_case(case)

    async def _mark_taken_down(self, action: Action) -> None:
        case = self.store.get(Case, action.case_id)
        if not case or case.taken_down_at:
            return
        case.taken_down_at = action.completed_at
        case.state = CaseState.taken_down
        case.add_event("taken_down", "Site removed at the source", f"{action.target} confirmed suspension/takedown", actor="partner", at=case.taken_down_at)
        self.store.put(case)
        self.audit.record("partner", "case.taken_down", case.id, channel=action.channel.value, target=action.target)
        await self._notify_case(case)

    async def _notify_case(self, case: Case) -> None:
        if self.on_case:
            r = self.on_case(case)
            if asyncio.iscoroutine(r):
                await r
