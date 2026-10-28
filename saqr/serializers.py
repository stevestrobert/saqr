"""API-facing summaries (shapes documented in docs/api.md)."""
from __future__ import annotations

from datetime import datetime

from .db import Store
from .models import Action, ActionStatus, Candidate, Case, Verdict


def _minutes(a: datetime | None, b: datetime | None) -> float | None:
    if a is None or b is None:
        return None
    return round((b - a).total_seconds() / 60, 2)


def verdict_summary(v: Verdict) -> dict:
    top = v.visual[0] if v.visual else None
    return {
        "label": v.label.value, "risk": v.risk, "confidence": v.confidence, "encoder": v.encoder,
        "components": {k: round(float(x), 3) for k, x in v.components.items()},
        "top_visual": ({"reference_id": top.reference_id, "reference_name": top.reference_name, "reference_domain": top.reference_domain,
                        "similarity": round(top.similarity, 4), "ssim": round(top.ssim, 4) if top.ssim is not None else None} if top else None),
        "form_summary": v.form.summary, "explanations": v.explanations, "recommended_action": v.recommended_action,
    }


def action_summary(actions: list[Action]) -> dict:
    return {
        "total": len(actions),
        "sent": sum(1 for a in actions if a.status in (ActionStatus.sent, ActionStatus.acknowledged, ActionStatus.completed)),
        "acknowledged": sum(1 for a in actions if a.status in (ActionStatus.acknowledged, ActionStatus.completed)),
        "completed": sum(1 for a in actions if a.status == ActionStatus.completed),
        "failed": sum(1 for a in actions if a.status == ActionStatus.failed),
        "blocking_confirmed": any(a.blocks_exposure and a.status in (ActionStatus.acknowledged, ActionStatus.completed) for a in actions),
    }


def case_summary(case: Case, store: Store, candidate: Candidate | None = None, actions: list[Action] | None = None) -> dict:
    cand = candidate or store.get(Candidate, case.candidate_id)
    acts = actions if actions is not None else store.actions_for_case(case.id)
    match = cand.match if cand else None
    return {
        "id": case.id, "domain": case.domain, "unicode_domain": match.unicode_domain if match else case.domain, "url": case.url,
        "state": case.state.value, "source": case.source.value, "created_at": case.created_at, "issued_at": case.issued_at,
        "detected_at": case.detected_at, "verified_at": case.verified_at, "approved_at": case.approved_at, "approved_by": case.approved_by,
        "blocked_at": case.blocked_at, "taken_down_at": case.taken_down_at,
        "verdict": verdict_summary(case.verdict),
        "protected_entity": (match.protected_entity if match else None) or (case.verdict.text.brand_mentions[0] if case.verdict.text.brand_mentions else None),
        "protected_domain": match.protected_domain if match else None,
        "lookalike_score": match.score if match else 0,
        "campaign_id": case.campaign_id, "report_count": len(case.report_ids),
        "action_summary": action_summary(acts),
        "screenshot_url": f"/api/cases/{case.id}/screenshot?view=desktop" if case.capture.screenshot_desktop else None,
        "thumbnail_url": f"/api/cases/{case.id}/screenshot?view=desktop&thumb=1" if case.capture.screenshot_desktop else None,
        "mobile_screenshot_url": f"/api/cases/{case.id}/screenshot?view=mobile" if case.capture.screenshot_mobile else None,
        "has_evidence": case.evidence_id is not None, "evidence_id": case.evidence_id,
        "minutes_to_identify": _minutes(case.issued_at, case.detected_at),
        "minutes_to_verify": _minutes(case.detected_at, case.verified_at),
        "minutes_exposure": _minutes(case.issued_at or case.detected_at, case.blocked_at),
        "title": case.capture.title, "iocs": case.iocs, "recheck_count": cand.recheck_count if cand else 0,
        "next_recheck_at": cand.next_recheck_at if cand else None,
    }
