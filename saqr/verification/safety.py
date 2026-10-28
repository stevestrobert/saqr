"""Target safety: the isolated browser must only ever be pointed at the public Internet.

Reports and intake endpoints accept attacker-supplied URLs, so without this check SAQR could be turned into
a server-side request forgery tool against localhost, link-local metadata services or private networks.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".localdomain")
BLOCKED_HOSTS = {"localhost", "0.0.0.0", "metadata", "metadata.google.internal", "instance-data"}


def host_is_public_literal(host: str) -> bool | None:
    """True/False for an IP literal, None when the host is a name."""
    try:
        ip = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return None
    return ip.is_global and not ip.is_multicast


def check_target(url: str, *, resolve: bool = False) -> str | None:
    """Return a reason string when the URL must not be fetched, None when it is acceptable."""
    try:
        p = urlparse(url)
    except Exception:
        return "unparseable URL"
    if p.scheme not in ("http", "https"):
        return f"scheme '{p.scheme}' is not allowed"
    host = (p.hostname or "").lower().rstrip(".")
    if not host:
        return "missing host"
    if host in BLOCKED_HOSTS or host.endswith(BLOCKED_SUFFIXES) or "." not in host and host_is_public_literal(host) is None:
        return "internal or non-public host name"
    literal = host_is_public_literal(host)
    if literal is False:
        return "private, loopback or link-local address"
    if p.port and p.port not in (80, 443, 8080, 8443):
        return f"port {p.port} is not a web port"
    if resolve and literal is None:
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror:
            return None  # unresolvable now: the capture will fail safely and be re-checked later
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if not ip.is_global:
                return f"name resolves to a non-public address ({ip})"
    return None


def host_is_blocked(host: str) -> bool:
    """Cheap check used inside the browser's request router (no DNS)."""
    host = (host or "").lower().rstrip(".")
    if not host:
        return False
    if host in BLOCKED_HOSTS or host.endswith(BLOCKED_SUFFIXES):
        return True
    return host_is_public_literal(host) is False
