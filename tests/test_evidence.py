import asyncio
import hashlib
import json
from pathlib import Path

from PIL import Image

from saqr.config import Settings
from saqr.evidence.package import EvidenceBuilder, merkle_root, sha256_file, verify_package
from saqr.evidence.timestamp import LocalSigner, build_tsq
from saqr.models import Capture, Case, CertEntry, FormInfo, InputField, Source, TextSignals, Verdict, VerdictLabel, utcnow


def test_merkle_root_is_order_independent_and_tamper_sensitive():
    a, b, c = (hashlib.sha256(x).hexdigest() for x in (b"a", b"b", b"c"))
    assert merkle_root([a, b, c]) == merkle_root([c, a, b])
    assert merkle_root([a, b, c]) != merkle_root([a, b])
    assert merkle_root([a]) != a  # leaf is prefixed before hashing


def test_rfc3161_request_is_well_formed():
    from asn1crypto import tsp
    digest = hashlib.sha256(b"manifest").hexdigest()
    req = tsp.TimeStampReq.load(build_tsq(digest, nonce=42))
    assert req["message_imprint"]["hashed_message"].native.hex() == digest
    assert req["message_imprint"]["hash_algorithm"]["algorithm"].native == "sha256"
    assert req["nonce"].native == 42 and req["cert_req"].native is True


def test_local_signer_roundtrip(tmp_path: Path):
    signer = LocalSigner(tmp_path / "keys", "node-test")
    digest = hashlib.sha256(b"x").hexdigest()
    ts = signer.sign_digest(digest, tmp_path / "timestamp.json")
    assert ts.kind == "local_signed" and ts.verified and LocalSigner.verify_file(tmp_path / "timestamp.json")
    # tamper with the payload -> signature fails
    data = json.loads((tmp_path / "timestamp.json").read_text())
    data["payload"]["time"] = "1999-01-01T00:00:00+00:00"
    (tmp_path / "timestamp.json").write_text(json.dumps(data))
    assert not LocalSigner.verify_file(tmp_path / "timestamp.json")


def _fake_case(tmp_path: Path) -> Case:
    cap_dir = tmp_path / "cap"
    cap_dir.mkdir()
    Image.new("RGB", (1280, 900), (200, 30, 30)).save(cap_dir / "d.png")
    Image.new("RGB", (390, 844), (200, 30, 30)).save(cap_dir / "m.png")
    (cap_dir / "page.html").write_text("<html><body>Pay now AE07 0331 2345 6789 0123 456 WhatsApp +971 50 000 0001</body></html>")
    cap = Capture(requested_url="https://rta-fines-refund.com/", final_url="https://rta-fines-refund.com/", status=200, ok=True,
                  title="Refund", text="Refund of fine. IBAN AE07 0331 2345 6789 0123 456. WhatsApp +971 50 000 0001", text_length=80,
                  screenshot_desktop=str(cap_dir / "d.png"), screenshot_mobile=str(cap_dir / "m.png"), html_path=str(cap_dir / "page.html"),
                  forms=[FormInfo(fields=[InputField(name="cardNumber", autocomplete="cc-number")])])
    verdict = Verdict(label=VerdictLabel.confirmed_fake, risk=90, confidence=0.9, components={"visual": 1, "logo": 1, "text": 1, "form": 1, "domain": 1},
                      explanations=["test"], text=TextSignals(brand_mentions=["Roads and Transport Authority (Dubai)"]))
    return Case(candidate_id="cand_x", domain="rta-fines-refund.com", url="https://rta-fines-refund.com/", source=Source.replay,
                detected_at=utcnow(), verdict=verdict, capture=cap)


def test_package_is_built_sealed_and_verifiable(tmp_path: Path):
    settings = Settings(data_dir=tmp_path / "var", tsa_urls="", node_name="node-test")
    settings.ensure_dirs()
    case = _fake_case(tmp_path)
    cert = CertEntry(source=Source.replay, log="Google Argon 2026h2", index=123, issuer="Let's Encrypt (R12)", domains=["rta-fines-refund.com"], fingerprint="ab" * 32)
    pkg = asyncio.run(EvidenceBuilder(settings).build(case, cert, demo_override=True))
    d = Path(pkg.directory)
    names = {a.name for a in pkg.artifacts}
    assert {"screenshot_desktop.png", "screenshot_mobile.png", "page.html", "page.txt", "capture.json", "dns.json", "registration.json",
            "hosting.json", "certificate.json", "ct_entry.json", "iocs.json", "verdict.json"} <= names
    assert pkg.iocs["ibans"] == ["AE070331234567890123456"] and "971500000001" in pkg.iocs["phones"][0] or pkg.iocs["phones"]
    assert pkg.timestamp and pkg.timestamp.kind == "local_signed" and pkg.timestamp.digest == pkg.manifest_sha256
    assert (d / "package.zip").exists() and (d / "report.html").exists() and (d / "chain_of_custody.json").exists()
    assert len(pkg.custody) >= 5 and pkg.custody[-1].event == "package_exported"
    manifest = json.loads((d / "manifest.json").read_text())
    assert manifest["merkle_root"] == pkg.merkle_root == merkle_root([a["sha256"] for a in manifest["artifacts"]])
    assert sha256_file(d / "manifest.json") == pkg.manifest_sha256
    # independent re-verification
    r = verify_package(d)
    assert r["artifacts_ok"] and r["merkle_root_ok"] and r["timestamp_ok"]
    # tamper with an artifact -> verification fails
    (d / "page.txt").write_text("edited")
    r2 = verify_package(d)
    assert not r2["artifacts_ok"]
    assert "Merkle root" in (d / "report.html").read_text()
