"""API smoke tests. The app starts the real pipeline (browser included) with no certificate source."""
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from saqr.api.app import create_app
from saqr.config import REPO_DIR, Settings

if "PLAYWRIGHT_BROWSERS_PATH" not in os.environ and Path("/opt/pw-browsers").exists():
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/pw-browsers"


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    data_dir = tmp_path_factory.mktemp("var")
    # reuse an already built gallery if the repo has one, otherwise the app builds it from fixtures on startup
    settings = Settings(data_dir=data_dir, ct_source="none", tsa_urls="", demo_autostart=False, verify_concurrency=1,
                        demo_sites_dir=REPO_DIR / "demo" / "sites", frontend_dist=Path("/nonexistent"))
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


def test_status_metrics_and_registry(client: TestClient):
    s = client.get("/api/status").json()
    assert s["version"] and s["encoder"]["name"] and s["protected_entities"] > 20 and s["demo"]["available"]
    m = client.get("/api/metrics").json()
    assert m["baseline_tti_minutes"] > 0 and "funnel" in m
    p = client.get("/api/protected").json()
    assert any(e["id"] == "rta" for e in p["entities"]) and "gov.ae" in p["official_suffixes"]
    assert client.get("/api/connectors").json()
    assert len(client.get("/api/gallery").json()) >= 5


def test_match_endpoint(client: TestClient):
    r = client.get("/api/match", params={"domain": "xn--tx-refund-gov-w1k.com"}).json()
    assert r["is_candidate"] and r["unicode_domain"].startswith("t") and any(x["kind"] == "homoglyph" for x in r["reasons"])
    assert client.get("/api/match", params={"domain": "www.rta.ae"}).json()["allowlisted"]


def test_report_intake_creates_candidate_and_campaign_and_official_links_are_ignored(client: TestClient):
    r = client.post("/api/reports", json={"channel": "sms", "sender": "+971501234567",
                                          "text": "RTA: refund AED 320 https://rta-fines-refund.com/refund (official: https://www.rta.ae)"}).json()
    assert r["report"]["sender_masked"].endswith("67") and r["report"]["urls"]
    assert [c["domain"] for c in r["candidates"]] == ["rta-fines-refund.com"]
    assert r["campaign"]["name"].startswith("CAMP-")
    assert client.get("/api/campaigns").json()
    assert client.get("/api/reports").json()[0]["id"] == r["report"]["id"]


def test_intake_rejects_official_urls(client: TestClient):
    assert client.post("/api/intake/url", json={"url": "https://eservices.tax.gov.ae/", "source": "manual"}).status_code == 409


def test_demo_controls_and_audit(client: TestClient):
    d = client.get("/api/demo").json()
    assert d["available"] and len(d["steps"]) >= 10 and d["sites"]
    assert client.post("/api/demo/inject", json={"domain": "salik-recharge-ae.com"}).json()["injected"]
    a = client.get("/api/audit").json()
    assert a["valid"] and a["length"] >= 1
    assert client.post("/api/audit/verify").json()["valid"]
    assert client.get("/api/cases/nope").status_code == 404
