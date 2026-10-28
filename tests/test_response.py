import asyncio

import pytest

from saqr.db import Store
from saqr.models import ActionStatus, Campaign, Capture, Case, CaseState, Channel, FormSignals, Report, Source, TextSignals, Verdict, VerdictLabel, utcnow
from saqr.response.audit import AuditLog
from saqr.response.campaigns import CampaignManager
from saqr.response.connectors import ALL_CONNECTORS, describe_connectors
from saqr.response.dispatcher import Dispatcher, DispatchRefused
from saqr.sensing.protected import get_registry
from saqr.sensing.reports import build_report


def _case(domain="rta-fines-refund.com", label=VerdictLabel.confirmed_fake, state=CaseState.open) -> Case:
    v = Verdict(label=label, risk=90 if label == VerdictLabel.confirmed_fake else 10, confidence=0.9,
                text=TextSignals(brand_mentions=["Roads and Transport Authority (Dubai)"], urgency_terms=["within 24 hours"]),
                form=FormSignals(collects_card=True, collects_cvv=True, summary="asks for a card number"))
    return Case(candidate_id="cand_1", domain=domain, url=f"https://{domain}/", source=Source.replay, detected_at=utcnow(), verdict=v,
                capture=Capture(requested_url=f"https://{domain}/", ok=True, text="x", text_length=1), state=state)


# ------------------------------------------------------------------------------------------------- audit
def test_audit_chain_detects_tampering():
    store = Store(":memory:")
    log = AuditLog(store)
    log.record("analyst", "case.approve", "case_1", domain="x.com")
    log.record("system", "action.sent", "act_1", channel="telecom")
    assert log.verify()["valid"]
    store._conn.execute("UPDATE audit SET detail='{\"domain\": \"y.com\"}' WHERE seq=1")
    r = log.verify()
    assert not r["valid"] and r["broken_at"] == 1


# -------------------------------------------------------------------------------------------- dispatcher
def _dispatcher(store: Store) -> Dispatcher:
    return Dispatcher(store, get_registry(), AuditLog(store), mode="simulate", ack_scale=0.01)


def test_allowlisted_domain_can_never_be_dispatched():
    store = Store(":memory:")
    case = _case(domain="eservices.rta.ae")
    store.put(case)
    with pytest.raises(DispatchRefused, match="official government property"):
        asyncio.run(_dispatcher(store).approve_and_dispatch(case, None, actor="analyst@demo"))
    assert store.count(type(case)) == 1 and not store.actions_for_case(case.id)


def test_human_identity_and_verdict_are_required():
    store = Store(":memory:")
    d = _dispatcher(store)
    with pytest.raises(DispatchRefused, match="analyst identity"):
        asyncio.run(d.approve_and_dispatch(_case(), None, actor="  "))
    with pytest.raises(DispatchRefused, match="does not justify"):
        asyncio.run(d.approve_and_dispatch(_case(label=VerdictLabel.benign), None, actor="a"))
    with pytest.raises(DispatchRefused, match="already"):
        asyncio.run(d.approve_and_dispatch(_case(state=CaseState.blocked), None, actor="a"))


def test_one_click_fans_out_to_every_channel_and_blocks_exposure():
    store = Store(":memory:")
    d = _dispatcher(store)
    case = _case()
    store.put(case)
    seen: list[str] = []
    d.on_action = lambda a: seen.append(a.status.value)

    async def run():
        actions = await d.approve_and_dispatch(case, None, actor="analyst@demo", note="approved in test")
        await asyncio.gather(*list(d._tasks))  # wait for simulated acknowledgements/completions
        return actions

    actions = asyncio.run(run())
    channels = {a.channel for a in actions}
    assert channels == {Channel.registrar, Channel.hosting, Channel.telecom, Channel.browser, Channel.bank, Channel.certificate_authority, Channel.national_cert}
    final = store.actions_for_case(case.id)
    assert all(a.status == ActionStatus.completed for a in final) and all(a.receipt for a in final)
    updated = store.get(Case, case.id)
    assert updated.approved_by == "analyst@demo" and updated.blocked_at is not None and updated.taken_down_at is not None
    assert updated.state == CaseState.taken_down
    kinds = [e.kind for e in updated.timeline]
    assert "approved" in kinds and "dispatched" in kinds and "blocked" in kinds and "taken_down" in kinds
    audit = store.audit_all()
    assert audit[0].action == "case.approve" and AuditLog(store).verify()["valid"]
    # telecom payload carries the indicators partners need
    telecom = next(a for a in final if a.channel == Channel.telecom)
    assert case.domain in telecom.payload["indicators"]["domains"]


def test_channel_subset_is_respected():
    store = Store(":memory:")
    d = _dispatcher(store)
    case = _case()
    store.put(case)
    actions = asyncio.run(d.approve_and_dispatch(case, None, actor="a", channels=[Channel.telecom]))
    assert {a.channel for a in actions} == {Channel.telecom}


def test_connectors_describe_themselves():
    desc = describe_connectors("simulate")
    assert len(desc) == len(ALL_CONNECTORS) and all(d["description"] for d in desc)


# --------------------------------------------------------------------------------------------- campaigns
def test_similar_messages_cluster_into_one_campaign_and_different_lures_do_not():
    store = Store(":memory:")
    cm = CampaignManager(store)
    r1 = build_report("sms", "Emirates Post: your parcel EP44871203AE could not be delivered. Pay the AED 11.50 redelivery fee: https://emiratespost-redelivery.shop/track", "+971521112233")
    r2 = build_report("sms", "EMIRATES POST – Parcel on hold. Redelivery fee AED 11.50 must be paid within 48 hours: https://ep-redelivery-fee.com/pay", "+971507654321")
    r3 = build_report("whatsapp", "Salik: your toll balance is negative (AED -45.00). Recharge now to avoid a AED 100 fine ➜ https://salik-recharge-ae.com", "+971559876543")
    for r in (r1, r2, r3):
        store.put(r)
    c1, c2, c3 = cm.assign_report(r1), cm.assign_report(r2), cm.assign_report(r3)
    assert c1.id == c2.id and c3.id != c1.id
    merged = store.get(Campaign, c1.id)
    assert set(merged.domains) == {"emiratespost-redelivery.shop", "ep-redelivery-fee.com"} and len(merged.report_ids) == 2
    assert merged.name.startswith("CAMP-") and ("parcel" in merged.name or "redelivery" in merged.name)


def test_case_attaches_to_campaign_by_domain_and_reports_are_privacy_safe():
    store = Store(":memory:")
    cm = CampaignManager(store)
    r = build_report("sms", "RTA refund AED 320: https://rta-fines-refund.com/refund — my Emirates ID is 784-1990-1234567-1", "+971501234567")
    store.put(r)
    camp = cm.assign_report(r)
    case = _case()
    store.put(case)
    attached = cm.attach_case(case, infra={"ips": ["1.2.3.4"]}, entity="Roads and Transport Authority (Dubai)")
    assert attached.id == camp.id and case.id in attached.case_ids and case.campaign_id == camp.id
    assert r.sender_masked == "+971 5* *** **67" and "784-1990" not in r.text and "[EID]" in r.text
    assert store.get(Report, r.id).reporter_ref and len(r.reporter_ref) == 16
