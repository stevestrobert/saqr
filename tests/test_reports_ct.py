import json
from pathlib import Path

from saqr.sensing.ct.certstream import message_to_entry
from saqr.sensing.ct.replay import ReplaySource, synthetic_domains
from saqr.sensing.ct.rfc6962 import leaf_to_entry, parse_leaf
from saqr.sensing.reports import build_report, domain_of, extract_iocs, extract_urls, lure_signature, similarity

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_real_ct_leaves_x509_and_precert():
    leaves = json.loads((FIXTURES / "ct_leaves.json").read_text())
    kinds = set()
    for leaf in leaves:
        parsed = parse_leaf(leaf["leaf_input"])
        assert parsed.domains == leaf["domains"]
        assert parsed.issuer == leaf["issuer"]
        assert parsed.is_precert == leaf["is_precert"]
        assert parsed.timestamp.isoformat() == leaf["timestamp"]
        kinds.add(parsed.is_precert)
        entry = leaf_to_entry(parsed, leaf["log"], leaf["index"])
        assert entry.index == leaf["index"] and entry.fingerprint and entry.issued_at == parsed.timestamp
    assert kinds == {True, False}


def test_certstream_message_conversion():
    msg = {"message_type": "certificate_update", "data": {"update_type": "PrecertLogEntry", "cert_index": 42, "seen": 1700000000.5,
           "leaf_cert": {"all_domains": ["Rta-Fines-Refund.com", "www.rta-fines-refund.com"], "not_before": 1699990000, "not_after": 1707766000, "fingerprint": "AA:BB"},
           "chain": [{"subject": {"O": "Let's Encrypt", "CN": "R12"}}], "source": {"name": "Google 'Argon2026h2' log", "url": "ct.googleapis.com/logs/us1/argon2026h2/"}}}
    e = message_to_entry(msg)
    assert e and e.domains[0] == "rta-fines-refund.com" and e.is_precert and e.issuer == "Let's Encrypt" and e.fingerprint == "aabb" and e.index == 42
    assert message_to_entry({"message_type": "heartbeat"}) is None


def test_replay_source_generates_plausible_names_and_injects():
    import asyncio
    src = ReplaySource(rate=200, seed=1)
    src.inject(["rta-fines-refund.com", "www.rta-fines-refund.com"], label="planted")

    async def take(n):
        out = []
        async for e in src.stream():
            out.append(e)
            if len(out) >= n:
                src.stop()
                break
        return out

    entries = asyncio.run(take(30))
    assert any("rta-fines-refund.com" in e.domains for e in entries)
    assert all(e.issuer and e.log and e.fingerprint and e.issued_at for e in entries)
    import random
    names = [d for _ in range(200) for d in synthetic_domains(random.Random(_))]
    assert all("." in d for d in names) and len(set(names)) > 150


def test_url_extraction_handles_defanged_shortened_and_arabic_text():
    text = ("RTA: refund AED 320 hxxps://rta-fines-refund[.]com/refund — also bit.ly/3xYz and https://salik-recharge-ae.com/ "
            "تفاصيل: www.emiratespost-redelivery.shop/track. Not a URL: e.g. 10.30 a.m.")
    urls = extract_urls(text)
    assert "https://rta-fines-refund.com/refund" in urls
    assert "https://bit.ly/3xYz" in urls
    assert "https://salik-recharge-ae.com/" in urls
    assert "https://www.emiratespost-redelivery.shop/track" in urls
    assert len(urls) == 4
    assert domain_of("https://www.emiratespost-redelivery.shop/track") == "emiratespost-redelivery.shop"


def test_report_masks_sender_and_scrubs_identifiers():
    r = build_report("sms", "Pay here https://x-fines.com my number 0501234567 and EID 784-1985-1234567-1", "+971 50 123 4567")
    assert r.sender_masked == "+971 5* *** **67" and r.reporter_ref
    assert "0501234567" not in r.text and "784-1985" not in r.text and r.domains == ["x-fines.com"]
    assert r.language == "en"


def test_ioc_extraction():
    iocs = extract_iocs("Transfer to IBAN AE07 0331 2345 6789 0123 456 or WhatsApp +971 50 000 0001, email refunds@rta-fines-refund.com, BTC bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")
    assert iocs["ibans"] == ["AE070331234567890123456"]
    assert iocs["phones"] == ["+971500000001"]
    assert iocs["emails"] == ["refunds@rta-fines-refund.com"]
    assert iocs["crypto_wallets"][0].startswith("bc1q")


def test_lure_similarity_ignores_urls_and_numbers():
    a = lure_signature("Emirates Post: your parcel EP44871203AE could not be delivered. Pay the AED 11.50 redelivery fee: https://a.shop/track")
    b = lure_signature("Emirates Post: your parcel EP99991111AE could not be delivered. Pay the AED 12.00 redelivery fee: https://b.online/x")
    c = lure_signature("Salik: your toll balance is negative. Recharge now https://c.com")
    assert similarity(a, b) > 0.7 and similarity(a, c) < 0.2
