"""Campaign grouping: reports and cases that belong to the same scam wave.

Two messages join a campaign when their lure text is similar (Jaccard over word shingles after removing URLs,
digits and stop-words), when they point at the same domain, or when the sites share infrastructure
(IP / ASN / registrar / certificate issuer+time). Analysts act on the whole campaign — one telecom filter rule
for the message pattern, one batch of takedowns — instead of one text at a time.
"""
from __future__ import annotations

from datetime import datetime, timezone

from ..db import Store
from ..models import Campaign, Case, Report, utcnow
from ..sensing.reports import lure_signature, similarity

TEXT_THRESHOLD = 0.3


class CampaignManager:
    def __init__(self, store: Store) -> None:
        self.store = store
        self._counter = store.kv_get("campaign_counter", 0)

    LURE_WORDS = ("fine", "fines", "refund", "parcel", "customs", "salik", "toll", "tax", "vat", "visa", "delivery", "redelivery",
                  "bill", "recharge", "overdue", "مخالفة", "استرداد", "رسوم", "غرامة")

    def _lure_hint(self, report: Report) -> str:
        words = lure_signature(report.text)
        return " ".join([w for w in self.LURE_WORDS if w in words][:2])

    def _name(self, report: Report | None, domain: str | None) -> str:
        self._counter += 1
        self.store.kv_set("campaign_counter", self._counter)
        year = datetime.now(timezone.utc).year
        hint = ""
        if report:
            hint = self._lure_hint(report) or (report.domains[0] if report.domains else "")
        elif domain:
            hint = domain
        return f"CAMP-{year}-{self._counter:04d}" + (f" · {hint}" if hint else "")

    # ------------------------------------------------------------------------------------------
    def assign_report(self, report: Report) -> Campaign:
        campaigns = self.store.list(Campaign)
        sig = lure_signature(report.text)
        best: tuple[float, Campaign | None] = (0.0, None)
        for c in campaigns:
            if c.status == "closed":
                continue
            score = 0.0
            if report.domains and set(report.domains) & set(c.domains):
                score = max(score, 1.0)
            if c.pattern:
                score = max(score, similarity(sig, lure_signature(c.pattern)))
            for rid in c.report_ids[-5:]:
                r = self.store.get(Report, rid)
                if r:
                    score = max(score, similarity(sig, lure_signature(r.text)))
            if score > best[0]:
                best = (score, c)
        if best[1] is not None and best[0] >= TEXT_THRESHOLD:
            camp = best[1]
            if not camp.pattern:
                # campaign was opened from a certificate detection; the first message gives it its lure
                camp.pattern = report.text[:300]
                hint = self._lure_hint(report)
                if hint and "." in camp.name.split(" · ")[-1]:
                    camp.name = f"{camp.name.split(' · ')[0]} · {hint}"
        else:
            camp = Campaign(name=self._name(report, None), pattern=report.text[:300])
        if report.id not in camp.report_ids:
            camp.report_ids.append(report.id)
        for d in report.domains:
            if d not in camp.domains:
                camp.domains.append(d)
        camp.last_seen = utcnow()
        self.store.put(camp)
        report.campaign_id = camp.id
        self.store.put(report)
        return camp

    def attach_case(self, case: Case, infra: dict[str, list[str]] | None = None, entity: str | None = None) -> Campaign | None:
        campaigns = self.store.list(Campaign)
        chosen: Campaign | None = None
        for c in campaigns:
            if case.domain in c.domains or set(case.report_ids) & set(c.report_ids):
                chosen = c
                break
        if chosen is None and infra:
            for c in campaigns:
                shared = {k: set(v) & set(infra.get(k, [])) for k, v in c.infrastructure.items()}
                if shared.get("ips") or (shared.get("asns") and shared.get("registrars")):
                    chosen = c
                    break
        if chosen is None and entity:
            # same imitated entity within the last 24h -> likely the same wave
            for c in campaigns:
                if c.entity == entity and (utcnow() - c.last_seen).total_seconds() < 86400 and c.status == "active":
                    chosen = c
                    break
        if chosen is None:
            if case.verdict.label.value not in {"confirmed_fake", "suspicious"}:
                return None
            chosen = Campaign(name=self._name(None, case.domain), entity=entity)
        if case.id not in chosen.case_ids:
            chosen.case_ids.append(case.id)
        if case.domain not in chosen.domains:
            chosen.domains.append(case.domain)
        if entity and not chosen.entity:
            chosen.entity = entity
        if infra:
            for k, v in infra.items():
                merged = list(dict.fromkeys(chosen.infrastructure.get(k, []) + v))
                chosen.infrastructure[k] = merged
        chosen.last_seen = utcnow()
        self.store.put(chosen)
        case.campaign_id = chosen.id
        return chosen

    def mark_contained(self, campaign_id: str) -> None:
        c = self.store.get(Campaign, campaign_id)
        if not c:
            return
        cases = [self.store.get(Case, cid) for cid in c.case_ids]
        if cases and all(x and x.state.value in {"blocked", "taken_down", "closed", "false_positive"} for x in cases):
            c.status = "contained"
            self.store.put(c)
