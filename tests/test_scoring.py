from datetime import datetime, timedelta, timezone

from saqr.models import Capture, CertEntry, FormInfo, InputField, LogoMatch, Source, VerdictLabel, VisualMatch
from saqr.sensing.matcher import LookalikeMatcher
from saqr.verification.scoring import decide, visual_component


def _capture(text: str, fields: list[InputField], title="Traffic Fines Refund · RTA Dubai", ok=True) -> Capture:
    return Capture(requested_url="https://rta-fines-refund.com/", final_url="https://rta-fines-refund.com/", status=200, ok=ok,
                   title=title, text=text, text_length=len(text), screenshot_desktop="x.png", forms=[FormInfo(fields=fields)])


FAKE_TEXT = ("Roads and Transport Authority هيئة الطرق والمواصلات Refund of overpaid traffic fine AED 320.00 "
             "Claim your refund within 24 hours or it will be forfeited. Card number Expiry CVV Enter the OTP sent to your phone")
CARD_FIELDS = [InputField(name="cardNumber", autocomplete="cc-number"), InputField(name="cvv", autocomplete="cc-csc"),
               InputField(name="expiry", autocomplete="cc-exp"), InputField(name="otp", placeholder="6-digit code")]
VIS_CLONE = [VisualMatch(reference_id="rta-ae", reference_name="RTA fines", reference_domain="rta.ae", similarity=0.93, ssim=0.75, encoder="perceptual")]
LOGO = [LogoMatch(reference_id="rta-ae", reference_domain="rta.ae", score=0.98)]


def test_clone_with_card_capture_is_confirmed_fake():
    m = LookalikeMatcher().match("rta-fines-refund.com")
    cert = CertEntry(source=Source.replay, issuer="Let's Encrypt", domains=["rta-fines-refund.com"], issued_at=datetime.now(timezone.utc) - timedelta(minutes=3))
    v = decide(capture=_capture(FAKE_TEXT, CARD_FIELDS), match=m, cert=cert, visual=VIS_CLONE, logos=LOGO, encoder="perceptual", domain="rta-fines-refund.com")
    assert v.label == VerdictLabel.confirmed_fake and v.risk >= 85
    assert v.form.collects_card and v.form.collects_otp and v.domain.free_ca and v.domain.cert_age_hours < 1
    assert any("card" in e.lower() for e in v.explanations) and any("layout" in e.lower() for e in v.explanations)


def test_text_and_form_only_fake_without_layout_copy_is_still_confirmed():
    m = LookalikeMatcher().match("moi-uae-fines-pay.com")
    cap = _capture("Ministry of Interior — UAE. Pay your traffic fines online. Card number, expiry, CVV.", CARD_FIELDS[:3], title="MOI fines")
    v = decide(capture=cap, match=m, cert=None, visual=[], logos=[], encoder="perceptual", domain="moi-uae-fines-pay.com")
    assert v.label == VerdictLabel.confirmed_fake and v.risk >= 72


def test_unrelated_business_sharing_a_word_is_benign():
    m = LookalikeMatcher().match("rta-ae-fitness.com")
    cap = _capture("RTA·AE Fitness Studio Al Quoz. Classes, memberships, contact us. Name, phone.",
                   [InputField(name="name"), InputField(name="phone", type="tel")], title="RTA·AE Fitness")
    low = [VisualMatch(reference_id="rta-ae", reference_name="RTA fines", reference_domain="rta.ae", similarity=0.1, ssim=0.1, encoder="perceptual")]
    v = decide(capture=cap, match=m, cert=None, visual=low, logos=[], encoder="perceptual", domain="rta-ae-fitness.com")
    assert v.label == VerdictLabel.benign and v.risk <= 30


def test_parked_or_unreachable_pages_are_inactive_for_recheck():
    m = LookalikeMatcher().match("dubaipolice-fines.online")
    parked = _capture("This domain was recently registered. Website coming soon.", [], title="dubaipolice-fines.online")
    v = decide(capture=parked, match=m, cert=None, visual=[], logos=[], encoder="perceptual", domain="dubaipolice-fines.online")
    assert v.label == VerdictLabel.inactive and v.recommended_action.startswith("Monitor")
    down = Capture(requested_url="https://x.com/", ok=False, error="net::ERR_NAME_NOT_RESOLVED")
    v2 = decide(capture=down, match=m, cert=None, visual=[], logos=[], encoder="perceptual", domain="dubaipolice-fines.online")
    assert v2.label == VerdictLabel.inactive


def test_official_domain_can_never_be_flagged_even_if_it_looks_like_itself():
    v = decide(capture=_capture(FAKE_TEXT, CARD_FIELDS), match=None, cert=None, visual=VIS_CLONE, logos=LOGO, encoder="perceptual", domain="eservices.rta.ae")
    assert v.label == VerdictLabel.official and v.risk == 0


def test_visual_component_mapping():
    assert visual_component(None, None) == 0.0
    assert visual_component(0.5, 0.3) == 0.0
    assert visual_component(0.95, 0.9) == 1.0
    assert 0 < visual_component(0.88, 0.7) < 1
