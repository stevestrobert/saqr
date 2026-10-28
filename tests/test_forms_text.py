from saqr.models import FormInfo, InputField
from saqr.verification.forms import analyse_forms, classify_field
from saqr.verification.text import analyse_text


def f(**kw) -> InputField:
    return InputField(**kw)


def test_card_fields_are_classified_from_autocomplete_names_placeholders_and_arabic_labels():
    assert classify_field(f(name="cardNumber", autocomplete="cc-number")).category == "card_number"
    assert classify_field(f(name="x1", placeholder="1234 5678 9012 3456", maxlength=19)).category == "card_number"
    assert classify_field(f(name="cvv", maxlength=4)).category == "cvv"
    assert classify_field(f(name="sec", label="رمز الأمان", maxlength=3)).category == "cvv"
    assert classify_field(f(name="exp", placeholder="MM/YY")).category == "expiry"
    assert classify_field(f(name="code", placeholder="Enter the 6-digit code sent by SMS")).category == "otp"
    assert classify_field(f(name="eid", placeholder="784-XXXX-XXXXXXX-X")).category == "emirates_id"
    assert classify_field(f(name="pw", type="password")).category == "password"
    assert classify_field(f(name="iban", label="IBAN")).category == "iban"


def test_lookup_fields_are_not_sensitive():
    assert classify_field(f(name="plateNumber", label="Plate number")).category == "lookup"
    assert classify_field(f(name="trn", label="Tax Registration Number (TRN)")).category == "lookup"
    assert classify_field(f(name="tracking", placeholder="Tracking number")).category == "lookup"
    assert classify_field(f(name="emiratesIdCard", label="Emirates ID card")).category == "emirates_id"


def test_official_inquiry_form_scores_low_and_card_form_scores_high():
    official = [FormInfo(fields=[f(name="plate", label="Plate number"), f(name="licence", label="Driving licence no.")])]
    fake = [FormInfo(fields=[f(name="cardNumber", autocomplete="cc-number"), f(name="cvv", autocomplete="cc-csc"),
                             f(name="expiry", autocomplete="cc-exp"), f(name="otp", placeholder="6-digit code")])]
    o, k = analyse_forms(official), analyse_forms(fake)
    assert o.risk == 0 and not o.collects_card and "lookup" in o.summary
    assert k.collects_card and k.collects_cvv and k.collects_otp and k.risk >= 0.95
    assert "OTP" in k.summary


def test_external_form_action_is_recorded():
    forms = [FormInfo(action="https://collector.evil.example/post", fields=[f(name="cardNumber", autocomplete="cc-number")])]
    s = analyse_forms(forms, page_host="rta-fines-refund.com")
    assert s.external_action_hosts == ["collector.evil.example"]


def test_text_signals_detect_entity_claims_payment_vocabulary_and_urgency():
    text = ("Roads and Transport Authority — هيئة الطرق والمواصلات. Refund of overpaid fine AED 320. "
            "Enter your card number and CVV. Claim within 24 hours or it will be forfeited.")
    s = analyse_text(text, title="Traffic fines refund")
    assert "Roads and Transport Authority (Dubai)" in s.brand_mentions
    assert "card number" in s.payment_terms and "cvv" in s.payment_terms
    assert "within 24 hours" in s.urgency_terms
    assert s.score >= 0.8


def test_unrelated_text_scores_low():
    s = analyse_text("Finesse Payroll — payroll software for UAE SMEs. Request a demo. Pricing starts at AED 99 per month.")
    assert not s.brand_mentions and s.score < 0.35
