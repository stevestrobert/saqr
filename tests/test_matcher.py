import time

import pytest

from saqr.sensing.matcher import LookalikeMatcher, typo_permutations
from saqr.sensing.normalize import segment, skeleton, split_domain, to_unicode


@pytest.fixture(scope="module")
def matcher() -> LookalikeMatcher:
    return LookalikeMatcher()


# --------------------------------------------------------------------------------------------- normalise
def test_punycode_decoding_and_skeleton():
    assert to_unicode("xn--tx-refund-gov-w1k.com") == "tаx-refund-gov.com"  # Cyrillic а
    assert skeleton("tаx-refund-gov.com") == "tax-refund-gov.com"
    assert skeleton("sаlik.ae") == "salik.ae"
    assert skeleton("g00gle") == "google"
    assert skeleton("rtá.ae") == "rta.ae"


def test_split_domain_uses_public_suffix_list():
    p = split_domain("eservices.tax.gov.ae")
    assert (p.subdomain, p.label, p.suffix) == ("eservices", "tax", "gov.ae")
    p = split_domain("shop.example.co.uk")
    assert (p.label, p.suffix) == ("example", "co.uk")
    p = split_domain("*.rta-fines.com")
    assert (p.subdomain, p.label, p.suffix) == ("", "rta-fines", "com")


def test_segmenter_splits_concatenated_vocabulary(matcher):
    assert segment("rtafinesrefund", matcher.vocab) == ["rta", "fines", "refund"]
    assert segment("finessepayroll", matcher.vocab) is None  # too much unknown: an unrelated word


# ----------------------------------------------------------------------------------------------- allowlist
@pytest.mark.parametrize("domain", ["rta.ae", "www.rta.ae", "eservices.tax.gov.ae", "anything.dubaipolice.gov.ae",
                                    "new-service.gov.ae", "u.ae", "dubai.ae", "*.salik.ae"])
def test_official_domains_are_allowlisted_never_candidates(matcher, domain):
    r = matcher.match(domain)
    assert r.allowlisted and not r.is_candidate and r.score == 0


def test_homograph_of_official_domain_is_not_allowlisted(matcher):
    r = matcher.match("xn--rt-fines-26g.com")  # rtа-fines.com with Cyrillic а
    assert not r.allowlisted and r.is_candidate
    assert any(x.kind == "homoglyph" for x in r.reasons)


# ----------------------------------------------------------------------------------------------- positives
@pytest.mark.parametrize("domain,entity_fragment", [
    ("rta-fines-refund.com", "Roads and Transport"),
    ("salik-recharge-ae.com", "Salik"),
    ("emiratespost-redelivery.shop", "Emirates Post"),
    ("moi-uae-fines-pay.com", "Ministry of Interior"),
    ("xn--tx-refund-gov-w1k.com", "Federal Tax Authority"),
    ("dubaipolice-fines.online", "Dubai Police"),
    ("dubai-police-fines.com", "Dubai Police"),
    ("rta.ae.secure-login.com", "Roads and Transport"),
    ("www-rta-ae.com", "Roads and Transport"),
    ("rtafinesrefund.xyz", "Roads and Transport"),
    ("salik.com", "Salik"),
    ("dubaipolce.com", "Dubai Police"),
    ("emiratspost.net", "Emirates Post"),
    ("uaepass-verify.top", "UAE PASS"),
    ("dewa-bill-pay.com", "Dubai Electricity"),
    ("e-dirham-pay.net", "Ministry of Finance"),
    ("tamm-abudhabi-fines.com", "TAMM"),
    ("mohre-fines.com", "Ministry of Human Resources"),
])
def test_lookalikes_are_candidates_with_correct_attribution(matcher, domain, entity_fragment):
    r = matcher.match(domain)
    assert r.is_candidate, (domain, r.score, r.summary)
    assert r.protected_entity and entity_fragment in r.protected_entity, (domain, r.protected_entity)


# ----------------------------------------------------------------------------------------------- negatives
@pytest.mark.parametrize("domain", ["mail.google.com", "paypal.com", "dubai-properties.com", "mydewalt-tools.com",
                                    "login.microsoftonline.com", "fine-dining-dubai.com", "emirates.com", "noon.com",
                                    "finesse-payroll.com", "moi.com", "rta.com", "s43dc.gamma.us-east-1.acm-acme.aws.dev",
                                    "*.cloudfront.net", "bills.com", "refund-portal.com"])
def test_ordinary_names_are_discarded(matcher, domain):
    r = matcher.match(domain)
    assert not r.is_candidate, (domain, r.score, r.summary)


def test_best_match_over_san_list_prefers_strongest_non_allowlisted(matcher):
    r = matcher.best_match(["www.example.com", "rta-fines-refund.com", "cdn.example.com"])
    assert r is not None and r.domain == "rta-fines-refund.com" and r.is_candidate


def test_reasons_are_explainable(matcher):
    r = matcher.match("rta-fines-refund.com")
    kinds = {x.kind for x in r.reasons}
    assert {"brand_token", "keyword", "combo"} <= kinds
    assert all(x.detail for x in r.reasons)


def test_typo_permutations_cover_classic_techniques():
    perms = typo_permutations("salik")
    assert {"slik", "saalik", "slaik", "salek"} <= perms  # omission, repetition, transposition, vowel swap


def test_throughput_is_sufficient_for_global_feed(matcher):
    names = [f"{w}{i}.com" for i, w in enumerate(["shop", "cloud", "mail", "api", "blog"] * 400)]
    t = time.perf_counter()
    for n in names:
        matcher.match(n)
    per_sec = len(names) / (time.perf_counter() - t)
    assert per_sec > 2000, per_sec  # global CT volume is ~150-400 certificates/second
