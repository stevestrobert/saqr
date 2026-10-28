"""Regression tests for issues found in code review."""
from pathlib import Path

from fastapi.testclient import TestClient

from saqr.api.app import create_app
from saqr.config import Settings
from saqr.models import Capture, VerdictLabel
from saqr.sensing.matcher import LookalikeMatcher
from saqr.verification.scoring import decide


def test_spa_handler_never_serves_files_outside_the_bundle(tmp_path: Path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>SPA</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("private key material")
    settings = Settings(data_dir=tmp_path / "var", ct_source="none", tsa_urls="", demo_autostart=False, frontend_dist=dist,
                        demo_sites_dir=tmp_path / "nosites")
    with TestClient(create_app(settings)) as c:
        assert c.get("/assets/app.js").text == "console.log(1)"
        assert "SPA" in c.get("/cases/abc").text
        for path in ("/%2e%2e/secret.txt", "/..%2fsecret.txt", "/assets/../../secret.txt", "/%2e%2e/%2e%2e/%2e%2e/etc/passwd"):
            r = c.get(path)
            assert "private key" not in r.text and "root:" not in r.text, path


def test_redirect_to_official_site_is_cloaking_not_exoneration():
    m = LookalikeMatcher().match("rta-fines-pay.com")
    cap = Capture(requested_url="https://rta-fines-pay.com/", final_url="https://www.rta.ae/en/home", status=200, ok=True,
                  title="RTA", text="Roads and Transport Authority official portal " * 5, text_length=250)
    v = decide(capture=cap, match=m, cert=None, visual=[], logos=[], encoder="perceptual", domain="rta-fines-pay.com")
    assert v.label == VerdictLabel.inactive and "redirected" in v.explanations[0]
    # the candidate's own name decides officialness, not where the page forwards to
    v2 = decide(capture=cap, match=None, cert=None, visual=[], logos=[], encoder="perceptual", domain="www.rta.ae")
    assert v2.label == VerdictLabel.official


def test_short_brands_do_not_match_inside_ordinary_words():
    m = LookalikeMatcher()
    for d in ("kitchenrefund.net", "switchrefund.com", "pitchfees.com", "textilesrefund.net"):
        assert not m.match(d).is_candidate, (d, m.match(d).tokens)
    r = m.match("rtafinesrefund.xyz")  # fully covered chunk: the short brand still counts
    assert r.is_candidate and "rta" in r.tokens


def test_embedded_domain_test_is_bounded():
    m = LookalikeMatcher()
    for d in ("menu.ae.cdn-host.com", "abu.ae.hosting.net", "smarta.ae.pages.dev", "karta.ae-shop.com", "dubai-aero.com", "www.dubai-aero.com"):
        assert not m.match(d).is_candidate, d
    assert m.match("rta.ae.secure-login.com").is_candidate
    assert m.match("www.rta.ae.evil.com").is_candidate
    assert m.match("www-rta-ae.com").is_candidate and m.match("login-dubai-ae.com").is_candidate


def test_digits_do_not_corrupt_tokenisation_but_still_catch_substitutions():
    m = LookalikeMatcher()
    assert not m.match("cedar82.com").is_candidate          # '8'->'b' must not turn 'cedar82' into 'darb'
    assert not m.match("portal.cedar82.com").is_candidate
    r = m.match("rt4-fines.com")
    assert r.is_candidate and "rta" in r.tokens              # whole chunk 'rt4' spells the brand after mapping
    assert m.match("m0i-fines.com").is_candidate


def test_speed_change_keeps_the_scenario_clock_and_reset_announces_itself(tmp_path: Path):
    settings = Settings(data_dir=tmp_path / "var", ct_source="none", tsa_urls="", demo_autostart=False)
    with TestClient(create_app(settings)) as c:
        state = c.post("/api/demo/start", json={"speed": 1}).json()
        assert state["running"] and state["speed"] == 1
        scenario = c.app.state.scenario
        scenario.started_at -= 10  # pretend 10 s of scenario time have passed
        faster = c.post("/api/demo/speed", json={"speed": 4}).json()
        assert faster["speed"] == 4
        assert 9.5 <= faster["elapsed_s"] <= 11, "changing the multiplier must not jump the scenario clock"
        # starting again with a speed while running only changes the speed, never restarts
        again = c.post("/api/demo/start", json={"speed": 2}).json()
        assert again["running"] and again["speed"] == 2 and 9.5 <= again["elapsed_s"] <= 12
        c.post("/api/demo/stop")
        c.post("/api/demo/reset")
        history = list(c.app.state.bus.history)
        assert any(e["type"] == "demo" and e["data"].get("kind") == "reset" for e in history)
        assert c.get("/api/cases").json() == []
