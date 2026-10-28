"""Partner connectors: one adapter per channel, same interface.

Each connector resolves its targets from the evidence package (registrar abuse contact from RDAP, hosting
abuse contact from the IP's RDAP, IBANs for banks, ...) and builds a complete, realistic request: the notice
text, the evidence hashes, the package reference. In `simulate` mode the request is logged and acknowledged
by a simulated partner after a short delay; in `live` mode the configured transport (SMTP / HTTPS API) is used.
The payloads are what a partner would receive, so a judge can read exactly what goes out.
"""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone

from ..models import Action, Case, Channel, EvidencePackage


@dataclass
class Target:
    name: str
    address: str              # e-mail / API endpoint / portal
    transport: str            # email | api | portal | rpz


@dataclass
class Receipt:
    receipt_id: str
    accepted: bool
    message: str
    ack_delay_s: float = 3.0            # how long the (simulated) partner takes to acknowledge
    completes: bool = False             # whether the partner later confirms completion (takedown done / block active)
    completion_delay_s: float = 0.0
    blocks_exposure: bool = False       # the action stops victims reaching the page


def _ref(case_id: str, channel: str) -> str:
    return f"SAQR-{case_id.split('_')[-1].upper()}-{channel.upper()[:3]}-{secrets.token_hex(2).upper()}"


def _evidence_block(pkg: EvidencePackage | None) -> str:
    if not pkg:
        return "Evidence package: pending."
    ts = pkg.timestamp
    return (f"Evidence package {pkg.id}: {len(pkg.artifacts)} artifacts, Merkle root {pkg.merkle_root[:16]}…, "
            f"manifest sha256 {pkg.manifest_sha256[:16]}…, time-stamped ({ts.kind} by {ts.authority}) at {ts.time.isoformat()}. "
            f"package.zip sha256 {pkg.zip_sha256[:16]}…" if ts else "")


class Connector:
    channel: Channel
    name: str
    description: str
    blocks_exposure = False

    def targets(self, case: Case, pkg: EvidencePackage | None) -> list[Target]:
        raise NotImplementedError

    def payload(self, case: Case, pkg: EvidencePackage | None, target: Target) -> dict:
        raise NotImplementedError

    def summary(self, case: Case, target: Target) -> str:
        return f"{self.name} → {target.name}"

    async def send(self, action: Action, mode: str) -> Receipt:
        """Transport. The MVP ships the simulated transport; live transports plug in here."""
        if mode == "live":
            # Placeholder for SMTP / partner API clients. Deliberately not implemented in the hackathon build.
            return Receipt(receipt_id=_ref(action.case_id, self.channel.value), accepted=False,
                           message="live transport not configured in this build", blocks_exposure=self.blocks_exposure)
        return Receipt(receipt_id=_ref(action.case_id, self.channel.value), accepted=True,
                       message="accepted by simulated partner endpoint", blocks_exposure=self.blocks_exposure)


# ------------------------------------------------------------------------------------------------ registrar
class RegistrarAbuseConnector(Connector):
    channel, name = Channel.registrar, "Registrar abuse desk"
    description = "Domain suspension request to the sponsoring registrar (abuse contact from RDAP), citing ICANN RAA 3.18 and UAE law."

    def targets(self, case, pkg):
        reg = (pkg.registration if pkg else {}) or {}
        contacts = reg.get("abuse_contacts") or []
        registrar = reg.get("registrar") or "sponsoring registrar (RDAP pending)"
        email = next((c for c in contacts if "@" in c), f"abuse@{registrar.split()[0].lower().strip(',')}.example" if registrar else "abuse@registrar.example")
        return [Target(name=registrar, address=email, transport="email")]

    def payload(self, case, pkg, target):
        return {
            "to": target.address, "subject": f"[URGENT] Phishing domain suspension request — {case.domain} impersonates a UAE government payment service",
            "body": (f"The domain {case.domain} hosts a page impersonating an official UAE government financial service "
                     f"({case.verdict.text.brand_mentions[0] if case.verdict.text.brand_mentions else 'government entity'}) and collects payment-card data "
                     f"from victims (verdict: {case.verdict.label.value}, risk {case.verdict.risk}/100). We request immediate suspension (clientHold/serverHold) "
                     f"under your abuse policy and ICANN RAA §3.18. This constitutes fraud and forgery under UAE Federal Decree-Law No. 34/2021 (Combatting "
                     f"Rumours and Cybercrimes). {_evidence_block(pkg)}"),
            "attachments": ["package.zip", "report.html"],
        }

    async def send(self, action, mode):
        r = await super().send(action, mode)
        r.ack_delay_s, r.completes, r.completion_delay_s = 6.0, True, 40.0   # registrars act in hours; compressed for the demo
        return r


# -------------------------------------------------------------------------------------------------- hosting
class HostingAbuseConnector(Connector):
    channel, name = Channel.hosting, "Hosting provider abuse desk"
    description = "Content takedown request to the hosting network (abuse contact from IP RDAP / ASN)."

    def targets(self, case, pkg):
        hosts = (pkg.hosting.get("hosts") if pkg else None) or []
        if not hosts:
            return [Target(name="hosting provider (ASN lookup pending)", address="abuse@hosting.example", transport="email")]
        h = hosts[0]
        contacts = h.get("abuse_contacts") or ["abuse@" + (h.get("as_name", "hosting").split()[0].lower()) + ".example"]
        return [Target(name=f"{h.get('as_name', 'hosting')} ({h.get('asn', '?')}, {h.get('ip', '')})", address=contacts[0], transport="email")]

    def payload(self, case, pkg, target):
        ip = (pkg.hosting.get("hosts", [{}])[0].get("ip") if pkg and pkg.hosting.get("hosts") else case.capture.ip) or "n/a"
        return {"to": target.address, "subject": f"Phishing content takedown — {case.domain} ({ip})",
                "body": f"Server {ip} on your network serves {case.url}, a fake government payment page harvesting card numbers, CVV and OTP codes. "
                        f"Please disable the content and preserve logs for law-enforcement follow-up. {_evidence_block(pkg)}",
                "attachments": ["package.zip"]}

    async def send(self, action, mode):
        r = await super().send(action, mode)
        r.ack_delay_s, r.completes, r.completion_delay_s = 7.0, True, 55.0
        return r


# -------------------------------------------------------------------------------------------------- telecom
class TelecomBlockConnector(Connector):
    channel, name = Channel.telecom, "Telecom operators (e&, du, Virgin Mobile) via TDRA"
    description = "Network-level URL/domain block for mobile and fixed subscribers plus an SMS-filter signature for the campaign lure."
    blocks_exposure = True

    def targets(self, case, pkg):
        return [Target(name="e& (Etisalat) network security", address="https://api.partner.example/etisalat/blocklist", transport="api"),
                Target(name="du network security", address="https://api.partner.example/du/blocklist", transport="api"),
                Target(name="TDRA national block list", address="https://api.partner.example/tdra/rpz", transport="rpz")]

    def payload(self, case, pkg, target):
        return {"action": "block", "indicators": {"domains": [case.domain, f"www.{case.domain}"], "urls": [case.url]},
                "sms_filter": {"pattern_hint": (case.verdict.text.urgency_terms[:2] + case.verdict.text.payment_terms[:2]) or ["fine", "refund"],
                               "link_domain": case.domain},
                "reason": "government-impersonation phishing", "risk": case.verdict.risk, "evidence_merkle_root": pkg.merkle_root if pkg else None,
                "rpz_record": f"{case.domain} CNAME . ; SAQR {case.id}" if target.transport == "rpz" else None}

    async def send(self, action, mode):
        r = await super().send(action, mode)
        r.ack_delay_s, r.completes, r.completion_delay_s, r.blocks_exposure = 3.0, True, 9.0, True
        return r


# -------------------------------------------------------------------------------------------------- browser
class BrowserBlocklistConnector(Connector):
    channel, name = Channel.browser, "Browser blocklists"
    description = "Reports to Google Safe Browsing, Microsoft SmartScreen and Apple/Tencent feeds so every major browser shows a red warning."
    blocks_exposure = True

    def targets(self, case, pkg):
        return [Target(name="Google Safe Browsing", address="https://safebrowsing.google.com/safebrowsing/report_phish/", transport="api"),
                Target(name="Microsoft SmartScreen", address="https://www.microsoft.com/wdsi/support/report-unsafe-site", transport="portal")]

    def payload(self, case, pkg, target):
        return {"url": case.url, "category": "phishing", "target_brand": case.verdict.text.brand_mentions[:1] or ["UAE government service"],
                "evidence": {"screenshot_sha256": next((a.sha256 for a in (pkg.artifacts if pkg else []) if a.name == "screenshot_desktop.png"), None),
                             "merkle_root": pkg.merkle_root if pkg else None}}

    async def send(self, action, mode):
        r = await super().send(action, mode)
        r.ack_delay_s, r.completes, r.completion_delay_s, r.blocks_exposure = 4.0, True, 20.0, True
        return r


# ----------------------------------------------------------------------------------------------------- bank
class BankFreezeConnector(Connector):
    channel, name = Channel.bank, "Banks / CBUAE fraud desk"
    description = "Account-freeze and card-monitoring request for IBANs, wallets and phone numbers shown on the page (via the UAE Banks Federation fraud channel)."

    def targets(self, case, pkg):
        iocs = (pkg.iocs if pkg else case.iocs) or {}
        has_accounts = bool(iocs.get("ibans") or iocs.get("crypto_wallets"))
        name = "CBUAE / UBF fraud desk" + (" — IBAN freeze" if has_accounts else " — mule-account watch (no IBAN on page)")
        return [Target(name=name, address="https://api.partner.example/ubf/fraud-desk", transport="api")]

    def payload(self, case, pkg, target):
        iocs = (pkg.iocs if pkg else case.iocs) or {}
        return {"request": "freeze_and_trace" if iocs.get("ibans") else "monitor_merchant_descriptors",
                "ibans": iocs.get("ibans", []), "wallets": iocs.get("crypto_wallets", []), "phones": iocs.get("phones", []),
                "merchant_hint": case.domain, "reason": "proceeds of government-impersonation phishing", "case": case.id,
                "evidence_merkle_root": pkg.merkle_root if pkg else None}

    async def send(self, action, mode):
        r = await super().send(action, mode)
        r.ack_delay_s, r.completes, r.completion_delay_s = 5.0, True, 30.0
        return r


# ---------------------------------------------------------------------------------- certificate authority
class CertificateRevocationConnector(Connector):
    channel, name = Channel.certificate_authority, "Issuing certificate authority"
    description = "Revocation / abuse report to the CA that issued the certificate (removes the padlock in browsers that check revocation)."

    def targets(self, case, pkg):
        issuer = (pkg.certificate.get("issuer") if pkg else None) or (case.capture.tls.issuer if case.capture.tls else "") or "issuing CA"
        short = issuer.split("(")[0].split(",")[0].replace("O=", "").strip() or "issuing CA"
        mailbox = short.split()[0].lower().strip("'")
        return [Target(name=short, address=f"cert-abuse@{mailbox}.example", transport="email")]

    def payload(self, case, pkg, target):
        return {"to": target.address, "subject": f"Revocation request — certificate for {case.domain} used in phishing",
                "body": f"Certificate {pkg.certificate.get('sha256', 'n/a') if pkg else 'n/a'} (CT: {pkg.ct_entry.get('log') if pkg else 'n/a'} "
                        f"#{pkg.ct_entry.get('index') if pkg else 'n/a'}) secures a government-impersonation phishing page. Please revoke under "
                        f"CA/B Forum BR 4.9.1.1 (certificate used for fraud). {_evidence_block(pkg)}"}

    async def send(self, action, mode):
        r = await super().send(action, mode)
        r.ack_delay_s, r.completes, r.completion_delay_s = 8.0, True, 70.0
        return r


# ------------------------------------------------------------------------------------------- national CERT
class NationalCertConnector(Connector):
    channel, name = Channel.national_cert, "aeCERT / Cyber Security Council"
    description = "Incident notification and IOC sharing with the national CERT and the imitated entity's security team."

    def targets(self, case, pkg):
        ent = case.verdict.text.brand_mentions[0] if case.verdict.text.brand_mentions else "imitated entity"
        return [Target(name="aeCERT incident intake", address="https://api.partner.example/aecert/incidents", transport="api"),
                Target(name=f"{ent} — security team", address="soc@entity.example", transport="email")]

    def payload(self, case, pkg, target):
        return {"incident_type": "brand-impersonation-phishing", "domain": case.domain, "url": case.url, "risk": case.verdict.risk,
                "iocs": (pkg.iocs if pkg else case.iocs), "campaign": case.campaign_id, "evidence_package": pkg.id if pkg else None,
                "merkle_root": pkg.merkle_root if pkg else None, "stix_hint": "indicator--" + hashlib.sha1(case.domain.encode()).hexdigest()[:12]}

    async def send(self, action, mode):
        r = await super().send(action, mode)
        r.ack_delay_s, r.completes, r.completion_delay_s = 2.0, True, 6.0
        return r


ALL_CONNECTORS: list[Connector] = [TelecomBlockConnector(), BrowserBlocklistConnector(), RegistrarAbuseConnector(),
                                   HostingAbuseConnector(), BankFreezeConnector(), CertificateRevocationConnector(), NationalCertConnector()]


def connectors_for(channels: list[Channel] | None) -> list[Connector]:
    if not channels:
        return ALL_CONNECTORS
    wanted = set(channels)
    return [c for c in ALL_CONNECTORS if c.channel in wanted]


def describe_connectors(mode: str) -> list[dict]:
    return [{"channel": c.channel.value, "name": c.name, "description": c.description, "mode": mode,
             "blocks_exposure": c.blocks_exposure} for c in ALL_CONNECTORS]


def now() -> datetime:
    return datetime.now(timezone.utc)
