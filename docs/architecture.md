# SAQR architecture

SAQR (صقر, *falcon*) is a single-node pipeline with four stages. Every stage is a Python package under `saqr/`,
every artefact is a pydantic model in `saqr/models.py`, and every state change is announced on an in-process event
bus that the dashboard follows over a WebSocket.

```
                 ┌──────────────────────────── SENSE ─────────────────────────────┐
  CT logs ──┐    │ sensing/ct/rfc6962.py   direct RFC 6962 tailer (get-sth/get-entries, leaf parsing)   │
  certstream┤───▶│ sensing/ct/certstream.py                                                             │
  replay ───┘    │ sensing/matcher.py      look-alike filter: allowlist, homoglyph skeleton, brand tokens,│
                 │                         typo permutations, edit distance, lure keywords, gov cues     │
  SMS/WhatsApp ─▶│ sensing/reports.py      URL extraction, privacy scrubbing, lure signatures             │
  partner/feeds ▶│                                                                                       │
                 └──────────────────────────────────┬────────────────────────────────────────────────────┘
                                                    ▼  Candidate (domain, url, match reasons, cert)
                 ┌──────────────────────────── ASSESS ────────────────────────────┐
                 │ verification/browser.py  isolated Chromium: desktop+mobile screenshots, DOM, text,     │
                 │                          forms+labels, redirects, TLS, HAR; demo domains served locally │
                 │ verification/visual.py   DINOv3/DINOv2 (optional) or perceptual encoder; gallery kNN;  │
                 │                          SSIM confirmation                                              │
                 │ verification/logos.py    multi-scale emblem template matching                          │
                 │ verification/forms.py    field classification: card, CVV, expiry, OTP, Emirates ID…    │
                 │ verification/text.py     entity claims (EN/AR), payment lexicon, urgency cues           │
                 │ verification/scoring.py  weighted fusion + decision rules → Verdict (label, risk, why)  │
                 └──────────────────────────────────┬────────────────────────────────────────────────────┘
                                                    ▼  Case (verdict, capture, timeline)
                 ┌──────────────────────────── QUALIFY ───────────────────────────┐
                 │ evidence/collectors.py   DNS, RDAP, live TLS certificate, IP→ASN, abuse contacts         │
                 │ evidence/package.py      artefacts + SHA-256, Merkle root, manifest, zip                 │
                 │ evidence/timestamp.py    RFC 3161 token (public TSA) or Ed25519 local timestamp         │
                 │ evidence/report.py       human-readable report.html                                    │
                 └──────────────────────────────────┬────────────────────────────────────────────────────┘
                                                    ▼  EvidencePackage
                 ┌──────────────────────────── RESPOND ───────────────────────────┐
                 │ response/dispatcher.py   safeguards (allowlist, human sign-off, verdict) → fan-out      │
                 │ response/connectors.py   registrar, hosting, telecom/TDRA, browsers, banks, CA, aeCERT  │
                 │ response/campaigns.py    clustering of reports/cases into campaigns                      │
                 │ response/audit.py        append-only hash-chained audit log                              │
                 └─────────────────────────────────────────────────────────────────────────────────────────┘
  pipeline.py orchestrates; api/app.py exposes REST + WebSocket and serves frontend/dist; demo/ scripts the scenario.
```

## Sense

**Why certificate logs.** A phishing page needs HTTPS (browsers mark plain HTTP pages "Not secure"), every publicly
trusted certificate must be submitted to Certificate Transparency logs before Chrome/Safari accept it, and the logs are
public. The scammer therefore publishes the domain name, within minutes, before the first SMS goes out. SAQR reads the
logs directly (RFC 6962 `get-sth` + `get-entries`), parses each `MerkleTreeLeaf`, extracts the certificate's subject and
every SAN, and keeps a per-log position so nothing is skipped. Two Google logs alone deliver ~150 certificates/second;
the filter runs at ~10,000 names/second in pure Python, so a single process keeps up with the whole global feed.
A certstream client is included as an alternative source and a replay source for offline demos.

**The cheap filter** (`sensing/matcher.py`) is deterministic and explainable. For every name:

1. *Allowlist*: official domains, their subdomains and the official suffixes (`gov.ae`, `mil.ae`, `ac.ae`, `sch.ae`) are
   never candidates (score 0, `allowlisted=True`). The check uses the raw ASCII name, so a homograph never passes.
2. *Normalisation*: punycode decode → Unicode TR39-style confusable skeleton (`tаx` with Cyrillic а → `tax`); public
   suffix split; tokenisation on `-`, `.`, digit boundaries; vocabulary-driven segmentation of concatenated chunks
   (`rtafinesrefund` → `rta` `fines` `refund`), with a cap on unknown characters so ordinary words are not split.
3. *Signals*: homograph of an official domain, official domain embedded (`rta.ae.secure-login.com`, `www-rta-ae.com`),
   TLD swap (`salik.com`), brand tokens (ambiguous short ones such as `rta`/`moi`/`tax` weigh less alone), dnstwist-style
   typo permutations of distinctive brands (`dubaipolce`, `emiratspost`), Damerau-Levenshtein near-misses, lure keywords
   (`fine`, `refund`, `redelivery`, `mukhalafat`…), government cues (`gov`, `uae`, `dubai`, `ae`…), abuse-prone TLD.
   A brand together with a keyword/cue gets a combination bonus.
4. *Score* capped at 100; `>= 35` is a candidate. Every point carries a reason string shown in the UI.

**Reactive inputs** (`sensing/reports.py`): forwarded SMS/WhatsApp/e-mail, bank/telecom submissions and threat feeds go
through the same verification. URLs are extracted even when defanged (`hxxps://x[.]com`), the reporter's number is masked
and hashed, and identifiers in the text (Emirates ID, phone numbers) are scrubbed before storage.

## Assess

`verification/browser.py` opens the candidate in a throw-away Chromium context (no cookies, HTTPS errors ignored,
downloads blocked, dialogs dismissed, optional upstream proxy), at desktop and mobile widths, and records: redirect
chain, status, TLS details, server IP, headers, title, language, visible text, DOM, every form with its fields and
resolved labels, third-party hosts, and a HAR. Demo domains are routed inside the browser to local fixture files, so a
capture of `rta-fines-refund.com` looks exactly like a real visit.

`verification/visual.py` embeds the above-the-fold screenshot and searches the reference gallery by cosine similarity,
confirming the top matches with SSIM. Two encoders share the interface:

* **DINO** — `facebook/dinov3-vits16-pretrain-lvd1689m` (gated; falls back to `facebook/dinov2-small`), CLS + mean patch
  token. Self-supervised ViT features are strong at near-duplicate and layout similarity without task training.
  Enabled with `pip install "saqr[ml]"` and `SAQR_VISUAL_ENCODER=dino`.
* **Perceptual** (default, no ML dependencies) — layout grid, low-frequency DCT, HSV histogram, edge grid, row/column
  colour profiles, colour layout and header band. *Calibration on the fixture set*: clones of a page score 0.92–0.94,
  other government portals built on a similar template 0.84–0.93, unrelated pages < 0.3. Top-1 is correct for every clone.

`verification/logos.py` runs multi-scale template matching (grayscale + edge correlation) of each reference emblem over
the upper part of the page; a copied emblem scores ≈1.0, a different emblem of similar shape ≤0.77, threshold 0.82.

`verification/forms.py` classifies every input from name/id/placeholder/label/autocomplete/type/maxlength in English
and Arabic: `card_number`, `cvv`, `expiry`, `cardholder`, `otp`, `emirates_id`, `password`, `iban`, `phone`, `email`,
`name`, `address`, `lookup` (plate, TRN, tracking number). Official portals look up a fine and hand off to a licensed
gateway; a government-styled page collecting PAN + CVV (+ OTP) on the spot is the strongest single signal.

`verification/scoring.py` fuses five components (visual 0.30, logo 0.10, text 0.15, form 0.25, domain 0.20) and applies
decision rules that make the obvious cases decisive: *layout copy + card capture → ≥90*; *layout/emblem + entity claim →
≥78*; *card capture + entity claim + look-alike name → ≥76*; *no layout, no emblem, no claim, no card form → ≤30*.
Labels: `confirmed_fake ≥72`, `suspicious ≥40`, `benign`, `inactive` (unreachable/parked/empty → scheduled re-check),
`official` (allow-listed safety net). The weights are hand-set for the MVP; the `decide()` function is the seam where a
model calibrated on historical impersonation cases plugs in with the same inputs and outputs.

## Qualify

`evidence/package.py` builds `var/evidence/<case>/` with screenshots, `page.html`, `page.txt`, `capture.json`,
`network.har`, `dns.json`, `registration.json` (RDAP), `certificate.json`/`.pem`, `hosting.json` (IP→ASN via Team Cymru
DNS, abuse contacts via RDAP), `ct_entry.json` (log URL + index: anyone can re-fetch the leaf), `iocs.json`,
`verdict.json`, then `manifest.json` (SHA-256 of every artefact, Merkle root, tool versions, operator), a time-stamp
over `sha256(manifest.json)` — RFC 3161 from a public TSA when reachable, otherwise an Ed25519 signature by the node key,
explicitly labelled — `chain_of_custody.json`, `report.html` and `package.zip`. `saqr evidence verify <dir>` recomputes
everything. Demo domains get clearly labelled synthetic infrastructure records.

## Respond

`response/dispatcher.py` enforces the safeguards in code, not in the UI: the domain is re-checked against the allowlist
at dispatch time, a named analyst must approve, and only `confirmed_fake`/`suspicious` cases can be dispatched. The
approval is written to the hash-chained audit log before anything is sent. Then every connector resolves its targets
from the evidence package and fires concurrently: registrar abuse desk (RDAP abuse contact; cites ICANN RAA 3.18 and
Federal Decree-Law 34/2021), hosting provider (ASN abuse contact), telecom operators via TDRA (URL block + SMS-filter
pattern + RPZ record), browser blocklists (Safe Browsing, SmartScreen), banks/CBUAE (IBANs, wallets, phones shown on the
page), the issuing CA (revocation, CA/B BR 4.9.1.1) and aeCERT. In `simulate` mode the realistic payloads are stored and
acknowledged by simulated partners after short delays; `live` mode is the seam for SMTP/API transports.

`response/campaigns.py` groups reports and cases by lure-text similarity (Jaccard over word shingles after removing URLs,
digits and stop-words), shared domains, shared infrastructure, and imitated entity within 24 h.

## Persistence, events, API

`db.py` is a small SQLite document store (JSON per model, a few indexed columns, WAL); `events.py` is the in-process bus
with a bounded history for late dashboards; `api/app.py` exposes the contract in `docs/api.md` and serves the compiled
React dashboard. Everything runs in one process with `saqr serve`.

## Honest limitations

* Fakes under meaningless names (`xk7q2.shop`), wildcard certificates, free-hosting subdomains and hacked legitimate sites
  do not show up in the name filter; they are caught reactively through reports and feeds (same verification).
* The perceptual encoder is a stand-in; DINOv3 is the intended encoder and needs the `ml` extra and model access.
* Partner connectors are simulated; real integrations need agreements and credentials (TDRA, telecoms, UBF, CAs).
* Baselines for the 70 % / 50 % comparison are configurable assumptions (see `docs/metrics.md`), not measured UAE data.
