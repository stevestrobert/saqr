"""Isolated browser capture with Playwright (Chromium).

Every candidate is opened in a throw-away browser context: no cookies, no storage, optional upstream proxy,
HTTPS errors ignored (we want to see the page even on a broken certificate), downloads disabled, dialogs
dismissed. We record the redirect chain, TLS details, response headers, server IP, the full-page screenshot
at desktop and mobile widths (SMS victims open these pages on phones), the HTML, the visible text, every
form with its fields and labels, third-party hosts contacted and a HAR of the whole visit for the evidence package.

Demo mode: fixture sites are served locally; requests to a planted domain are routed to the fixture server
inside the browser so the capture looks exactly like a visit to that domain.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx

from ..models import Capture, FormInfo, InputField, TlsInfo

log = logging.getLogger(__name__)

DESKTOP = {"width": 1280, "height": 800}
MOBILE = {"width": 390, "height": 844}
MOBILE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
             "Version/17.5 Mobile/15E148 Safari/604.1")
DESKTOP_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/130.0.0.0 Safari/537.36")

FORMS_JS = """
() => {
  const labelFor = (el) => {
    if (el.labels && el.labels.length) return Array.from(el.labels).map(l => l.innerText.trim()).join(' ');
    const aria = el.getAttribute('aria-label'); if (aria) return aria;
    const byId = el.id ? document.querySelector(`label[for="${el.id}"]`) : null; if (byId) return byId.innerText.trim();
    const parentLabel = el.closest('label'); if (parentLabel) return parentLabel.innerText.trim();
    let prev = el.previousElementSibling; let hops = 0;
    while (prev && hops < 3) { const t = (prev.innerText || '').trim(); if (t && t.length < 80) return t; prev = prev.previousElementSibling; hops++; }
    const wrap = el.parentElement; if (wrap) { const lab = wrap.querySelector('label'); if (lab) return lab.innerText.trim(); }
    return '';
  };
  const fieldOf = (el) => ({
    name: el.getAttribute('name') || '', id: el.id || '', type: (el.getAttribute('type') || el.tagName.toLowerCase()),
    placeholder: el.getAttribute('placeholder') || '', label: labelFor(el).slice(0, 120),
    autocomplete: el.getAttribute('autocomplete') || '',
    maxlength: el.maxLength > 0 && el.maxLength < 1000 ? el.maxLength : null,
  });
  const forms = Array.from(document.querySelectorAll('form')).map(f => {
    const btn = f.querySelector('button[type=submit], input[type=submit], button:not([type])');
    return {
      action: f.getAttribute('action') || '', method: (f.getAttribute('method') || 'get').toLowerCase(),
      fields: Array.from(f.querySelectorAll('input, select, textarea')).map(fieldOf),
      submit_text: btn ? (btn.innerText || btn.value || '').trim().slice(0, 60) : '',
    };
  });
  // inputs outside any <form> (common on JS-driven phishing kits)
  const loose = Array.from(document.querySelectorAll('input:not(form input), select:not(form select), textarea:not(form textarea)')).map(fieldOf);
  if (loose.length) forms.push({ action: '', method: 'js', fields: loose, submit_text: '' });
  const meta = {};
  document.querySelectorAll('meta[name], meta[property]').forEach(m => { const k = m.getAttribute('name') || m.getAttribute('property'); if (k && !(k in meta)) meta[k] = (m.getAttribute('content') || '').slice(0, 200); });
  return { forms, meta, lang: document.documentElement.lang || '', text: (document.body ? document.body.innerText : '').slice(0, 20000) };
}
"""


def _ts(value) -> datetime | None:
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    except Exception:
        return None


class BrowserCapturer:
    """One shared Chromium process; a fresh isolated context per capture."""

    def __init__(self, timeout_ms: int = 20000, proxy: str | None = None, capture_mobile: bool = True) -> None:
        self.timeout_ms = timeout_ms
        self.proxy = proxy
        self.capture_mobile = capture_mobile
        self._pw = None
        self._browser = None
        self._lock = asyncio.Lock()
        self._http = httpx.AsyncClient(timeout=10, follow_redirects=True)

    async def start(self) -> None:
        if self._browser:
            return
        from playwright.async_api import async_playwright

        self._pw = await async_playwright().start()
        kwargs = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]}
        if self.proxy:
            kwargs["proxy"] = {"server": self.proxy}
        try:
            self._browser = await self._pw.chromium.launch(**kwargs)
        except Exception as exc:
            fallback = os.environ.get("SAQR_CHROMIUM_PATH", "/opt/pw-browsers/chromium")
            if Path(fallback).exists():
                log.warning("default chromium launch failed (%s); using %s", exc, fallback)
                self._browser = await self._pw.chromium.launch(executable_path=fallback, **kwargs)
            else:
                raise

    async def close(self) -> None:
        try:
            if self._browser:
                await self._browser.close()
            if self._pw:
                await self._pw.stop()
        finally:
            self._browser = None
            self._pw = None
            await self._http.aclose()

    # ------------------------------------------------------------------------------------------
    async def capture(self, url: str, out_dir: Path, *, domain: str | None = None, override_base: str | None = None,
                      tag: str = "capture") -> Capture:
        await self.start()
        out_dir.mkdir(parents=True, exist_ok=True)
        cap = Capture(requested_url=url)
        started = time.time()
        domain = (domain or urlparse(url).hostname or "").lower()
        try:
            await asyncio.wait_for(self._capture(url, domain, out_dir, override_base, cap, tag), timeout=self.timeout_ms / 1000 * 3)
        except asyncio.TimeoutError:
            cap.ok = False
            cap.error = cap.error or "capture timed out"
        except Exception as exc:
            cap.ok = False
            cap.error = cap.error or f"{type(exc).__name__}: {exc}"[:300]
        cap.duration_ms = int((time.time() - started) * 1000)
        return cap

    async def _route_guard(self, route) -> None:
        """Never let a suspect page (or its redirects) pull the browser onto internal addresses."""
        from .safety import host_is_blocked

        if host_is_blocked(urlparse(route.request.url).hostname or ""):
            await route.abort()
            return
        await route.continue_()

    async def _route_override(self, route, override_base: str, domain: str) -> None:
        """Serve requests for a demo domain from a local directory (or an HTTP base URL) inside the browser."""
        req_url = route.request.url
        parsed = urlparse(req_url)
        host = (parsed.hostname or "").lower()
        if host == domain or host == f"www.{domain}":
            path = parsed.path or "/"
            if path.endswith("/"):
                path += "index.html"
            if override_base.startswith("http"):
                target = override_base.rstrip("/") + path + (f"?{parsed.query}" if parsed.query else "")
                try:
                    r = await self._http.get(target)
                    headers = {"content-type": r.headers.get("content-type", "text/html; charset=utf-8"),
                               "server": "nginx", "x-saqr-demo-override": "1"}
                    await route.fulfill(status=r.status_code, headers=headers, body=r.content)
                except Exception as exc:
                    log.debug("override fetch failed for %s: %s", target, exc)
                    await route.abort()
                return
            base = Path(override_base).resolve()
            file = (base / path.lstrip("/")).resolve()
            if file.is_dir():
                file = file / "index.html"
            if base not in file.parents and file != base:
                await route.fulfill(status=403, body=b"forbidden")
                return
            if not file.exists():
                # any unknown path on the fake site shows the landing page (phishing kits usually behave this way)
                file = base / "index.html"
            if not file.exists():
                await route.fulfill(status=404, headers={"content-type": "text/html"}, body=b"<html><body><h1>404 Not Found</h1></body></html>")
                return
            import mimetypes
            ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
            if ctype.startswith("text/"):
                ctype += "; charset=utf-8"
            await route.fulfill(status=200, headers={"content-type": ctype, "server": "nginx", "x-saqr-demo-override": "1"}, body=file.read_bytes())
            return
        await route.continue_()

    async def _capture(self, url: str, domain: str, out_dir: Path, override_base: str | None, cap: Capture, tag: str) -> None:
        assert self._browser is not None
        har_path = out_dir / f"{tag}.har"
        context = await self._browser.new_context(
            viewport=DESKTOP, user_agent=DESKTOP_UA, ignore_https_errors=True, accept_downloads=False,
            locale="en-AE", timezone_id="Asia/Dubai", java_script_enabled=True,
            record_har_path=str(har_path), record_har_content="embed",
        )
        context.set_default_timeout(self.timeout_ms)
        if override_base:
            await context.route("**/*", lambda route: asyncio.ensure_future(self._route_override(route, override_base, domain)))
            cap.resolved_via = "demo-override"
        else:
            await context.route("**/*", lambda route: asyncio.ensure_future(self._route_guard(route)))
            cap.resolved_via = "dns"
        page_host = domain
        external: set[str] = set()
        resources = {"count": 0}

        def on_request(req):
            resources["count"] += 1
            h = (urlparse(req.url).hostname or "").lower()
            if h and h != page_host and not h.endswith("." + page_host) and h != f"www.{page_host}":
                external.add(h)

        page = await context.new_page()
        page.on("request", on_request)
        page.on("dialog", lambda d: asyncio.ensure_future(d.dismiss()))
        try:
            response = await page.goto(url, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=4000)
            except Exception:
                pass
            await page.wait_for_timeout(600)
            if response is not None:
                cap.status = response.status
                cap.headers = {k: v[:300] for k, v in (await response.all_headers()).items()
                               if k.lower() in {"server", "content-type", "x-powered-by", "via", "cf-ray", "x-cache", "date", "location", "strict-transport-security"}}
                try:
                    addr = await response.server_addr()
                    if addr:
                        cap.ip = addr.get("ipAddress", "")
                except Exception:
                    pass
                try:
                    sec = await response.security_details()
                    if sec:
                        cap.tls = TlsInfo(issuer=sec.get("issuer", ""), subject=sec.get("subjectName", ""), protocol=sec.get("protocol", ""),
                                          valid_from=_ts(sec.get("validFrom")), valid_to=_ts(sec.get("validTo")),
                                          sans=[sec.get("subjectName", "")] if sec.get("subjectName") else [])
                except Exception:
                    pass
                chain = []
                req = response.request
                while req.redirected_from is not None:
                    req = req.redirected_from
                    chain.insert(0, req.url)
                cap.redirects = chain
            cap.final_url = page.url
            cap.title = (await page.title() or "")[:200]
            data = await page.evaluate(FORMS_JS)
            cap.lang = data.get("lang", "")
            cap.text = data.get("text", "")
            cap.text_length = len(cap.text)
            cap.meta = data.get("meta", {})
            cap.forms = [FormInfo(action=f.get("action", ""), method=f.get("method", ""), submit_text=f.get("submit_text", ""),
                                  fields=[InputField(**{k: v for k, v in fld.items() if k in InputField.model_fields}) for fld in f.get("fields", [])])
                         for f in data.get("forms", [])]
            html = await page.content()
            html_path = out_dir / f"{tag}.html"
            html_path.write_text(html, encoding="utf-8")
            cap.html_path = str(html_path)
            shot = out_dir / f"{tag}_desktop.png"
            await page.screenshot(path=str(shot), full_page=True)
            cap.screenshot_desktop = str(shot)
            cap.ok = cap.status is None or cap.status < 400 or len(cap.text.strip()) > 40
            if cap.status is not None and cap.status >= 400 and len(cap.text.strip()) <= 40:
                cap.error = f"HTTP {cap.status}"
        except Exception as exc:
            cap.ok = False
            cap.error = f"{type(exc).__name__}: {str(exc).splitlines()[0]}"[:300]
        finally:
            await page.close()

        if self.capture_mobile and cap.ok:
            try:
                mpage = await context.new_page()
                await mpage.set_viewport_size(MOBILE)
                await mpage.set_extra_http_headers({"user-agent": MOBILE_UA})
                await mpage.goto(cap.final_url or url, wait_until="domcontentloaded")
                await mpage.wait_for_timeout(500)
                mshot = out_dir / f"{tag}_mobile.png"
                await mpage.screenshot(path=str(mshot), full_page=True)
                cap.screenshot_mobile = str(mshot)
                await mpage.close()
            except Exception as exc:
                log.debug("mobile capture failed: %s", exc)
        cap.external_hosts = sorted(external)
        cap.resource_count = resources["count"]
        await context.close()  # flushes the HAR
        if har_path.exists():
            cap.har_path = str(har_path)
            self._trim_har(har_path)

    @staticmethod
    def _trim_har(path: Path, limit: int = 6_000_000) -> None:
        """Keep evidence packages manageable: drop embedded bodies when the HAR is very large."""
        try:
            if path.stat().st_size <= limit:
                return
            har = json.loads(path.read_text(encoding="utf-8"))
            for e in har.get("log", {}).get("entries", []):
                content = e.get("response", {}).get("content", {})
                if content.get("text") and len(content["text"]) > 20000:
                    content["text"] = ""
                    content["comment"] = "body dropped (size)"
            path.write_text(json.dumps(har), encoding="utf-8")
        except Exception:
            pass
