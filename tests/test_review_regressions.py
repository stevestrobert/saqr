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


def test_embedded_domain_test_is_bounded():
    m = LookalikeMatcher()
    for d in ("menu.ae.cdn-host.com", "abu.ae.hosting.net", "smarta.ae.pages.dev", "karta.ae-shop.com"):
        assert not m.match(d).is_candidate, d
    assert m.match("rta.ae.secure-login.com").is_candidate
    assert m.match("www.rta.ae.evil.com").is_candidate
