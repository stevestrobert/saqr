"""Evidence package builder.

Directory layout (settings.evidence_dir/<case_id>/):
    screenshot_desktop.png, screenshot_mobile.png, page.html, page.txt, capture.json, network.har,
    dns.json, registration.json, certificate.json (+ certificate.pem), hosting.json, ct_entry.json, iocs.json,
    verdict.json, manifest.json, timestamp.tsr | timestamp.json, chain_of_custody.json, report.html
    package.zip  (everything above)

manifest.json lists every artifact with SHA-256 and size, the Merkle root over the artifact hashes, tool versions
and the operator. The time-stamp token covers sha256(manifest.json). Anyone holding the package can recompute
the hashes, the Merkle root and verify the token without trusting SAQR.
"""
from __future__ import annotations

import hashlib
import json
import mimetypes
import shutil
import zipfile
from pathlib import Path
from typing import Any

import httpx

from .. import __version__
from ..config import Settings
from ..models import Artifact, Case, CertEntry, CustodyEvent, EvidencePackage
from ..sensing.reports import extract_iocs
from .collectors import collect_certificate, collect_dns, collect_hosting, collect_rdap, synthetic_infrastructure
from .report import render_report
from .timestamp import LocalSigner, obtain_timestamp


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def merkle_root(hashes_hex: list[str]) -> str:
    """Binary Merkle tree over sorted leaf hashes (duplicate last node on odd levels), RFC 6962-style prefixes."""
    if not hashes_hex:
        return hashlib.sha256(b"").hexdigest()
    level = [hashlib.sha256(b"\x00" + bytes.fromhex(h)).digest() for h in sorted(hashes_hex)]
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        level = [hashlib.sha256(b"\x01" + level[i] + level[i + 1]).digest() for i in range(0, len(level), 2)]
    return level[0].hex()


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


class EvidenceBuilder:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.signer = LocalSigner(settings.keys_dir, settings.node_name)

    async def build(self, case: Case, cert: CertEntry | None, *, demo_override: bool, actor: str = "system") -> EvidencePackage:
        s = self.settings
        out = s.evidence_dir / case.id
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        pkg = EvidencePackage(case_id=case.id, domain=case.domain, directory=str(out))
        custody: list[CustodyEvent] = []

        def log(event: str, detail: str = "") -> None:
            custody.append(CustodyEvent(actor=actor, event=event, detail=detail))

        cap = case.capture
        log("capture_imported", f"browser capture of {cap.final_url or cap.requested_url} taken at {cap.captured_at.isoformat()}")
        # 1. copy capture artifacts
        for src, name, desc in ((cap.screenshot_desktop, "screenshot_desktop.png", "Full-page screenshot, 1280px desktop viewport"),
                                (cap.screenshot_mobile, "screenshot_mobile.png", "Full-page screenshot, 390px mobile viewport"),
                                (cap.html_path, "page.html", "Rendered DOM (document.documentElement.outerHTML)"),
                                (cap.har_path, "network.har", "HTTP Archive of the visit (requests, responses, bodies)")):
            if src and Path(src).exists():
                shutil.copy2(src, out / name)
                pkg.artifacts.append(self._artifact(out / name, desc))
        (out / "page.txt").write_text(cap.text, encoding="utf-8")
        pkg.artifacts.append(self._artifact(out / "page.txt", "Visible page text (innerText)"))
        _write_json(out / "capture.json", json.loads(cap.model_dump_json()))
        pkg.artifacts.append(self._artifact(out / "capture.json", "Capture metadata: redirects, status, headers, TLS, forms, resources"))

        # 2. infrastructure
        if demo_override:
            infra = synthetic_infrastructure(case.domain, cert.issuer if cert else "unknown")
            dns_d, reg_d, host_d, cert_d = infra["dns"], infra["registration"], infra["hosting"], infra["certificate"]
            log("infrastructure_collected", "demo domain: synthetic infrastructure records (labelled)")
        else:
            async with httpx.AsyncClient(headers={"user-agent": f"saqr-evidence/{__version__}"}) as client:
                dns_d = await collect_dns(case.domain, s.resolver_list)
                reg_d = await collect_rdap(case.domain, s.rdap_bootstrap, client)
                host_d = await collect_hosting(dns_d.get("ips", []) or ([cap.ip] if cap.ip else []), client, s.resolver_list)
                cert_d = await collect_certificate(case.domain)
            log("infrastructure_collected", f"DNS via {','.join(s.resolver_list)}; RDAP via {reg_d.get('source', 'n/a')}; TLS handshake; IP->ASN")
        if cert_d.get("pem"):
            (out / "certificate.pem").write_text(cert_d.pop("pem"), encoding="utf-8")
            pkg.artifacts.append(self._artifact(out / "certificate.pem", "Leaf certificate presented by the server (PEM)"))
        for name, data, desc in (("dns.json", dns_d, "DNS records at capture time"), ("registration.json", reg_d, "Registration data (RDAP)"),
                                 ("hosting.json", host_d, "Hosting: IP, ASN, network, abuse contacts"), ("certificate.json", cert_d, "TLS certificate details")):
            _write_json(out / name, data)
            pkg.artifacts.append(self._artifact(out / name, desc))
        pkg.dns, pkg.registration, pkg.hosting, pkg.certificate = dns_d, {k: v for k, v in reg_d.items() if k != "raw"}, host_d, cert_d

        # 3. CT entry (independently verifiable: log URL + index)
        if cert:
            ct = {"log": cert.log, "index": cert.index, "logged_at": cert.issued_at, "issuer": cert.issuer, "domains": cert.domains,
                  "is_precert": cert.is_precert, "leaf_sha256": cert.fingerprint, "not_before": cert.not_before, "not_after": cert.not_after,
                  "verify": f"GET <log>/ct/v1/get-entries?start={cert.index}&end={cert.index} and compare sha256(leaf_input)" if cert.index else ""}
            _write_json(out / "ct_entry.json", ct)
            pkg.artifacts.append(self._artifact(out / "ct_entry.json", "Certificate Transparency log entry that triggered detection"))
            pkg.ct_entry = json.loads(json.dumps(ct, default=str))

        # 4. IOCs (bank accounts, wallets, phones shown on the page) and verdict
        iocs = extract_iocs(cap.text + "\n" + (Path(cap.html_path).read_text(encoding="utf-8", errors="ignore") if cap.html_path and Path(cap.html_path).exists() else ""))
        for k, v in case.iocs.items():
            iocs[k] = sorted(set(iocs.get(k, [])) | set(v))
        pkg.iocs = iocs
        _write_json(out / "iocs.json", iocs)
        pkg.artifacts.append(self._artifact(out / "iocs.json", "Indicators shown on the page: IBANs, phone numbers, wallets, e-mails"))
        _write_json(out / "verdict.json", json.loads(case.verdict.model_dump_json()))
        pkg.artifacts.append(self._artifact(out / "verdict.json", "Automated verification result and explanations"))
        log("artifacts_hashed", f"{len(pkg.artifacts)} artifacts hashed with SHA-256")

        # 5. manifest + Merkle root
        pkg.merkle_root = merkle_root([a.sha256 for a in pkg.artifacts])
        pkg.tool_versions = {"saqr": __version__, "playwright": _ver("playwright"), "cryptography": _ver("cryptography"), "python": _pyver()}
        manifest = {
            "package_id": pkg.id, "case_id": case.id, "domain": case.domain, "url": case.url, "created_at": pkg.created_at,
            "operator": {"node": s.node_name, "organisation": s.organisation},
            "verdict": {"label": case.verdict.label.value, "risk": case.verdict.risk, "confidence": case.verdict.confidence},
            "artifacts": [a.model_dump() for a in pkg.artifacts], "merkle_root": pkg.merkle_root, "tool_versions": pkg.tool_versions,
            "hash_algorithm": "sha256", "merkle": "RFC 6962-style binary tree over sorted artifact hashes",
        }
        _write_json(out / "manifest.json", manifest)
        pkg.manifest_sha256 = sha256_file(out / "manifest.json")
        log("manifest_sealed", f"manifest sha256 {pkg.manifest_sha256}; merkle root {pkg.merkle_root}")

        # 6. trusted timestamp over the manifest hash
        pkg.timestamp = await obtain_timestamp(pkg.manifest_sha256, s.tsa_url_list, out, self.signer, s.tsa_timeout_s)
        log("timestamped", f"{pkg.timestamp.kind} by {pkg.timestamp.authority} at {pkg.timestamp.time.isoformat()}")

        # 7. custody + report + zip
        pkg.custody = custody
        _write_json(out / "chain_of_custody.json", [c.model_dump() for c in custody])
        (out / "report.html").write_text(render_report(case, pkg), encoding="utf-8")
        zip_path = out / "package.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(out.iterdir()):
                if p.name != "package.zip":
                    z.write(p, p.name)
        pkg.zip_path = str(zip_path)
        pkg.zip_sha256 = sha256_file(zip_path)
        custody.append(CustodyEvent(actor=actor, event="package_exported", detail=f"package.zip sha256 {pkg.zip_sha256}"))
        _write_json(out / "chain_of_custody.json", [c.model_dump() for c in custody])
        return pkg

    @staticmethod
    def _artifact(path: Path, description: str) -> Artifact:
        mime = mimetypes.guess_type(path.name)[0] or ("application/json" if path.suffix in {".har", ".json"} else "application/octet-stream")
        return Artifact(name=path.name, path=path.name, sha256=sha256_file(path), size=path.stat().st_size, mime=mime, description=description)


def verify_package(directory: Path) -> dict[str, Any]:
    """Recompute hashes and the Merkle root from disk — what a court or partner would do."""
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    results = []
    ok_all = True
    for a in manifest["artifacts"]:
        p = directory / a["path"]
        ok = p.exists() and sha256_file(p) == a["sha256"]
        ok_all &= ok
        results.append({"name": a["name"], "ok": ok})
    root_ok = merkle_root([a["sha256"] for a in manifest["artifacts"]]) == manifest["merkle_root"]
    ts_ok = None
    if (directory / "timestamp.json").exists():
        ts_ok = LocalSigner.verify_file(directory / "timestamp.json")
        payload = json.loads((directory / "timestamp.json").read_text(encoding="utf-8"))["payload"]
        ts_ok = ts_ok and payload["digest_sha256"] == sha256_file(directory / "manifest.json")
    return {"artifacts_ok": ok_all, "merkle_root_ok": root_ok, "timestamp_ok": ts_ok, "artifacts": results}


def _ver(pkg: str) -> str:
    try:
        from importlib.metadata import version
        return version(pkg)
    except Exception:
        return "unknown"


def _pyver() -> str:
    import sys
    return sys.version.split()[0]
