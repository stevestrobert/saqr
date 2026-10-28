"""Infrastructure collectors: DNS records, registration data (RDAP), the live TLS certificate, hosting (IP -> ASN).

Every collector is best-effort and records *how* it got its answer (resolver, endpoint, time) or why it
failed, because an evidence package must be reproducible by a third party. Demo-overridden domains have
no real infrastructure; the collectors then return clearly labelled synthetic records.
"""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import socket
import ssl
from datetime import datetime, timezone
from typing import Any

import dns.asyncresolver
import dns.rdatatype
import httpx
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization

RDAP_FALLBACK = {
    "com": "https://rdap.verisign.com/com/v1/", "net": "https://rdap.verisign.com/net/v1/",
    "org": "https://rdap.publicinterestregistry.org/rdap/", "ae": "https://rdap.aeda.net.ae/",
    "shop": "https://rdap.nic.shop/", "online": "https://rdap.nic.online/", "top": "https://rdap.nic.top/",
    "xyz": "https://rdap.nic.xyz/", "site": "https://rdap.nic.site/", "info": "https://rdap.identitydigital.services/rdap/",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------------------------------- DNS
async def collect_dns(domain: str, resolvers: list[str], timeout: float = 4.0) -> dict[str, Any]:
    res = dns.asyncresolver.Resolver(configure=False)
    res.nameservers = resolvers
    res.lifetime = timeout
    out: dict[str, Any] = {"domain": domain, "resolvers": resolvers, "queried_at": _now(), "records": {}, "errors": {}}
    for rtype in ("A", "AAAA", "CNAME", "NS", "MX", "TXT", "SOA"):
        try:
            answer = await res.resolve(domain, rtype)
            out["records"][rtype] = sorted(r.to_text() for r in answer)
        except Exception as exc:
            out["errors"][rtype] = type(exc).__name__
    try:
        answer = await res.resolve("www." + domain, "A")
        out["records"]["www_A"] = sorted(r.to_text() for r in answer)
    except Exception:
        pass
    ips = out["records"].get("A", []) + out["records"].get("AAAA", [])
    out["ips"] = ips
    return out


# ---------------------------------------------------------------------------------------------------- RDAP
async def collect_rdap(domain: str, bootstrap: str, client: httpx.AsyncClient) -> dict[str, Any]:
    tld = domain.rsplit(".", 1)[-1]
    urls = [f"{bootstrap.rstrip('/')}/domain/{domain}"]
    if tld in RDAP_FALLBACK:
        urls.append(f"{RDAP_FALLBACK[tld].rstrip('/')}/domain/{domain}")
    out: dict[str, Any] = {"domain": domain, "queried_at": _now(), "sources_tried": urls}
    for u in urls:
        try:
            r = await client.get(u, headers={"accept": "application/rdap+json"}, timeout=8, follow_redirects=True)
            if r.status_code == 404:
                out["status"] = "not found (unregistered or registry without RDAP)"
                out["source"] = u
                return out
            r.raise_for_status()
            data = r.json()
            out["source"] = u
            out.update(_summarise_rdap(data))
            out["raw"] = data
            return out
        except Exception as exc:
            out.setdefault("errors", []).append(f"{u}: {type(exc).__name__}")
    out["status"] = "unavailable"
    return out


def _summarise_rdap(data: dict) -> dict[str, Any]:
    s: dict[str, Any] = {"status": "ok", "registrar": "", "abuse_contacts": [], "events": {}, "nameservers": [], "domain_status": data.get("status", [])}
    for ev in data.get("events", []):
        s["events"][ev.get("eventAction", "?")] = ev.get("eventDate")
    s["nameservers"] = [ns.get("ldhName", "").lower() for ns in data.get("nameservers", [])]
    for ent in data.get("entities", []):
        roles = ent.get("roles", [])
        vcard = ent.get("vcardArray", [None, []])[1] if ent.get("vcardArray") else []
        name = next((v[3] for v in vcard if v and v[0] == "fn"), "")
        emails = [v[3] for v in vcard if v and v[0] == "email"]
        if "registrar" in roles:
            s["registrar"] = name or ent.get("handle", "")
            for sub in ent.get("entities", []):
                if "abuse" in sub.get("roles", []):
                    svc = sub.get("vcardArray", [None, []])[1] if sub.get("vcardArray") else []
                    s["abuse_contacts"] += [v[3] for v in svc if v and v[0] in ("email", "tel")]
        if "abuse" in roles:
            s["abuse_contacts"] += emails
    s["abuse_contacts"] = sorted(set(s["abuse_contacts"]))
    return s


# ----------------------------------------------------------------------------------------------- TLS cert
def _fetch_cert_sync(host: str, port: int = 443, timeout: float = 6.0) -> bytes:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with socket.create_connection((host, port), timeout=timeout) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as ssock:
            return ssock.getpeercert(binary_form=True)


async def collect_certificate(domain: str) -> dict[str, Any]:
    out: dict[str, Any] = {"domain": domain, "queried_at": _now()}
    try:
        der = await asyncio.get_running_loop().run_in_executor(None, _fetch_cert_sync, domain)
    except Exception as exc:
        out["status"] = f"unavailable ({type(exc).__name__})"
        return out
    cert = x509.load_der_x509_certificate(der)
    out.update(parse_certificate(cert))
    out["pem"] = cert.public_bytes(serialization.Encoding.PEM).decode()
    out["status"] = "ok"
    return out


def parse_certificate(cert: x509.Certificate) -> dict[str, Any]:
    sans: list[str] = []
    try:
        sans = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName)
    except Exception:
        pass
    scts = 0
    try:
        scts = len(cert.extensions.get_extension_for_class(x509.PrecertificateSignedCertificateTimestamps).value)
    except Exception:
        pass
    return {
        "subject": cert.subject.rfc4514_string(), "issuer": cert.issuer.rfc4514_string(),
        "serial": format(cert.serial_number, "x"), "not_before": cert.not_valid_before_utc.isoformat(),
        "not_after": cert.not_valid_after_utc.isoformat(), "sans": sans,
        "sha256": cert.fingerprint(hashes.SHA256()).hex(), "sct_count": scts,
        "public_key_type": type(cert.public_key()).__name__,
    }


# ------------------------------------------------------------------------------------------------ hosting
async def collect_hosting(ips: list[str], client: httpx.AsyncClient, resolvers: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {"queried_at": _now(), "hosts": []}
    for ip in ips[:4]:
        info: dict[str, Any] = {"ip": ip}
        try:
            addr = ipaddress.ip_address(ip)
            info["private"] = addr.is_private
        except ValueError:
            continue
        # Team Cymru IP->ASN DNS service (works wherever DNS works)
        try:
            res = dns.asyncresolver.Resolver(configure=False)
            res.nameservers = resolvers
            res.lifetime = 4
            if addr.version == 4:
                q = ".".join(reversed(ip.split("."))) + ".origin.asn.cymru.com"
            else:
                nib = addr.exploded.replace(":", "")
                q = ".".join(reversed(nib)) + ".origin6.asn.cymru.com"
            ans = await res.resolve(q, "TXT")
            txt = ans[0].to_text().strip('"')
            parts = [p.strip() for p in txt.split("|")]
            info["asn"] = "AS" + parts[0].split()[0]
            info["prefix"], info["country"], info["registry"] = parts[1], parts[2], parts[3]
            ans2 = await res.resolve(f"AS{parts[0].split()[0]}.asn.cymru.com", "TXT")
            info["as_name"] = ans2[0].to_text().strip('"').split("|")[-1].strip()
        except Exception as exc:
            info["asn_error"] = type(exc).__name__
        # IP RDAP for abuse contact
        try:
            r = await client.get(f"https://rdap.org/ip/{ip}", headers={"accept": "application/rdap+json"}, timeout=8, follow_redirects=True)
            if r.status_code == 200:
                d = r.json()
                info["network_name"] = d.get("name")
                info["network_handle"] = d.get("handle")
                abuse = []
                for ent in d.get("entities", []):
                    if "abuse" in ent.get("roles", []):
                        vc = ent.get("vcardArray", [None, []])[1] if ent.get("vcardArray") else []
                        abuse += [v[3] for v in vc if v and v[0] == "email"]
                    for sub in ent.get("entities", []):
                        if "abuse" in sub.get("roles", []):
                            vc = sub.get("vcardArray", [None, []])[1] if sub.get("vcardArray") else []
                            abuse += [v[3] for v in vc if v and v[0] == "email"]
                info["abuse_contacts"] = sorted(set(abuse))
        except Exception as exc:
            info["rdap_error"] = type(exc).__name__
        out["hosts"].append(info)
    return out


def synthetic_infrastructure(domain: str, cert_issuer: str) -> dict[str, dict[str, Any]]:
    """Deterministic, clearly-labelled infrastructure for demo domains that do not exist on the Internet."""
    h = hashlib.sha256(domain.encode()).digest()
    ip = f"{185 + h[0] % 10}.{h[1]}.{h[2]}.{max(1, h[3])}"
    registrars = [("NameCheap, Inc.", ["abuse@namecheap.com"]), ("NameSilo, LLC", ["abuse@namesilo.com"]),
                  ("PDR Ltd. d/b/a PublicDomainRegistry.com", ["abuse-contact@publicdomainregistry.com"]),
                  ("Hostinger Operations, UAB", ["abuse@hostinger.com"]), ("Porkbun LLC", ["abuse@porkbun.com"])]
    hosts = [("AS47583", "HOSTINGER-AS", ["abuse@hostinger.com"]), ("AS13335", "CLOUDFLARENET", ["abuse@cloudflare.com"]),
             ("AS14061", "DIGITALOCEAN-ASN", ["abuse@digitalocean.com"]), ("AS16276", "OVH SAS", ["abuse@ovh.net"]),
             ("AS210644", "AEZA-AS", ["abuse@aeza.net"])]
    reg, abuse = registrars[h[4] % len(registrars)]
    asn, asname, habuse = hosts[h[5] % len(hosts)]
    created = datetime.now(timezone.utc).replace(microsecond=0)
    created = created.replace(hour=max(0, created.hour - (h[6] % 20)))
    note = "SYNTHETIC — demo domain served from the local fixture server; real collectors run against live DNS/RDAP/TLS."
    return {
        "dns": {"domain": domain, "queried_at": _now(), "resolvers": ["demo-override"], "records": {"A": [ip], "NS": [f"ns1.{reg.split(',')[0].split()[0].lower()}-dns.com", f"ns2.{reg.split(',')[0].split()[0].lower()}-dns.com"]}, "ips": [ip], "note": note},
        "registration": {"domain": domain, "status": "ok", "registrar": reg, "abuse_contacts": abuse, "events": {"registration": created.isoformat()},
                         "nameservers": [], "domain_status": ["client transfer prohibited"], "source": "demo-override", "note": note},
        "hosting": {"queried_at": _now(), "hosts": [{"ip": ip, "asn": asn, "as_name": asname, "country": "NL" if h[7] % 2 else "LT", "abuse_contacts": habuse}], "note": note},
        "certificate": {"domain": domain, "status": "from CT log entry", "issuer": cert_issuer, "sans": [domain, f"www.{domain}"],
                        "sha256": hashlib.sha256(f"cert:{domain}".encode()).hexdigest(), "note": note},
    }
