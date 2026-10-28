"""Trusted timestamps for evidence packages.

Preferred: RFC 3161 time-stamp token from a public TSA (the token binds the manifest hash to a time signed by
a third party, so nobody — including us — can claim the capture happened at another moment).
Fallback: a locally signed timestamp (Ed25519 key generated on first run). It proves integrity and an origin
but not independent time; the package says so explicitly. In production the national TSA or a UAE PASS
signing service replaces both.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx
from asn1crypto import algos, cms, core, tsp
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

from ..models import Timestamp

log = logging.getLogger(__name__)


# ------------------------------------------------------------------------------------------------- RFC 3161
def build_tsq(digest_hex: str, nonce: int | None = None) -> bytes:
    req = tsp.TimeStampReq({
        "version": "v1",
        "message_imprint": tsp.MessageImprint({
            "hash_algorithm": algos.DigestAlgorithm({"algorithm": "sha256"}),
            "hashed_message": bytes.fromhex(digest_hex),
        }),
        "cert_req": True,
    })
    if nonce is not None:
        req["nonce"] = core.Integer(nonce)
    return req.dump()


def parse_tsr(data: bytes, expected_digest_hex: str) -> tuple[datetime, str, bool]:
    """Return (gen_time, tsa_name, imprint_matches)."""
    resp = tsp.TimeStampResp.load(data)
    status = resp["status"]["status"].native
    if status not in ("granted", "granted_with_mods"):
        raise ValueError(f"TSA refused: {status} {resp['status']['status_string'].native}")
    token = resp["time_stamp_token"]
    signed: cms.SignedData = token["content"]
    tst_info = signed["encap_content_info"]["content"].parsed
    gen_time = tst_info["gen_time"].native
    imprint = tst_info["message_imprint"]["hashed_message"].native.hex()
    tsa = ""
    try:
        tsa = tst_info["tsa"].chosen.native.get("common_name", "") if tst_info["tsa"].native else ""
    except Exception:
        pass
    if not tsa:
        try:
            certs = signed["certificates"]
            tsa = certs[0].chosen["tbs_certificate"]["subject"].native.get("common_name", "")
        except Exception:
            tsa = "unknown TSA"
    return gen_time, tsa, imprint == expected_digest_hex.lower()


async def rfc3161_timestamp(digest_hex: str, tsa_urls: list[str], out_path: Path, timeout: float = 6.0) -> Timestamp | None:
    tsq = build_tsq(digest_hex, nonce=int.from_bytes(os.urandom(8), "big"))
    async with httpx.AsyncClient(timeout=timeout) as client:
        for url in tsa_urls:
            try:
                r = await client.post(url, content=tsq, headers={"content-type": "application/timestamp-query"})
                r.raise_for_status()
                gen_time, tsa, ok = parse_tsr(r.content, digest_hex)
                out_path.write_bytes(r.content)
                return Timestamp(kind="rfc3161", authority=f"{tsa} ({url})", time=gen_time, token_path=out_path.name,
                                 digest=digest_hex, verified=ok, note="RFC 3161 token; verify with `openssl ts -verify`.")
            except Exception as exc:
                log.info("TSA %s unavailable: %s", url, type(exc).__name__)
    return None


# ------------------------------------------------------------------------------------------ local fallback
class LocalSigner:
    def __init__(self, keys_dir: Path, node_name: str) -> None:
        keys_dir.mkdir(parents=True, exist_ok=True)
        self.key_path = keys_dir / "node_ed25519.pem"
        self.pub_path = keys_dir / "node_ed25519.pub"
        self.node_name = node_name
        if self.key_path.exists():
            self.key = serialization.load_pem_private_key(self.key_path.read_bytes(), password=None)
        else:
            self.key = ed25519.Ed25519PrivateKey.generate()
            self.key_path.write_bytes(self.key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                            serialization.NoEncryption()))
            self.pub_path.write_bytes(self.public_pem())
            try:
                os.chmod(self.key_path, 0o600)
            except Exception:
                pass

    def public_pem(self) -> bytes:
        return self.key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)

    def key_id(self) -> str:
        return hashlib.sha256(self.public_pem()).hexdigest()[:16]

    def sign_digest(self, digest_hex: str, out_path: Path) -> Timestamp:
        now = datetime.now(timezone.utc)
        payload = {"digest_sha256": digest_hex, "time": now.isoformat(), "signer": self.node_name, "key_id": self.key_id(),
                   "alg": "Ed25519", "purpose": "SAQR evidence manifest timestamp (local; not a third-party TSA)"}
        msg = json.dumps(payload, sort_keys=True).encode()
        sig = self.key.sign(msg)
        out_path.write_text(json.dumps({"payload": payload, "signature_b64": base64.b64encode(sig).decode(),
                                        "public_key_pem": self.public_pem().decode()}, indent=2), encoding="utf-8")
        return Timestamp(kind="local_signed", authority=f"{self.node_name} (Ed25519 key {self.key_id()})", time=now,
                         token_path=out_path.name, digest=digest_hex, verified=True,
                         note="No public TSA reachable: signed locally. Proves integrity/origin, not independent time; "
                              "production uses the national TSA.")

    @staticmethod
    def verify_file(path: Path) -> bool:
        data = json.loads(path.read_text(encoding="utf-8"))
        pub = serialization.load_pem_public_key(data["public_key_pem"].encode())
        msg = json.dumps(data["payload"], sort_keys=True).encode()
        try:
            pub.verify(base64.b64decode(data["signature_b64"]), msg)
            return True
        except Exception:
            return False


async def obtain_timestamp(digest_hex: str, tsa_urls: list[str], out_dir: Path, signer: LocalSigner, timeout: float = 6.0) -> Timestamp:
    ts = await rfc3161_timestamp(digest_hex, tsa_urls, out_dir / "timestamp.tsr", timeout) if tsa_urls else None
    if ts:
        return ts
    return signer.sign_digest(digest_hex, out_dir / "timestamp.json")
