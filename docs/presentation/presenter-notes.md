# SAQR — presenter notes

Deck: `docs/presentation/index.html` (open the file, or `http://localhost:8000/docs/presentation/` when the node is
running — then slide 11 embeds the live dashboard). Keys: `→` / `space` next · `←` back · `N` notes panel · `F`
fullscreen · `?` help. The same notes appear in the deck's `N` panel; this sheet adds timing, the demo click-script and
a Q&A crib.

**Total: 8 minutes** — 5 for the slides, 3 for the live demo. Speak to the visuals; the slides carry almost no text on
purpose.

---

## 1 · Title (10 s)

"SAQR means falcon. It spots a fake government payment page the moment a scammer sets it up, and lets one analyst block
it everywhere with one click." Move on; the ticker in the background is the live certificate feed — we come back to it.

## 2 · The problem (40 s)

Walk the chain left to right: look-alike name → free certificate in minutes → SMS wave → victims type card number, CVV
and the one-time code → the money moves. Only then come complaints, hours or days later — **that is where identification
happens today**. Takedown is manual and sequential: registrar, host, telecoms.

Numbers: over 75 % of breaches start with phishing or fraudulent messages, scam messages up 35 % in a year (UAE Cyber
Security Council); the fake stays online for days.

## 3 · The insight (45 s)

The whole idea in one picture. A convincing fake needs HTTPS; to get a certificate the scammer goes to a CA; every
publicly trusted CA **must** write the certificate to public Certificate Transparency logs before Chrome and Safari accept
it. Watch the chip travel: the name ends up in a stream anyone can read — usually before the first SMS goes out. SAQR
reads that stream directly. Two Google logs alone gave 150 certificates a second in our tests; the cheap name filter keeps
about one in three thousand. Nothing touches citizens: no taps, no phones — only what the attacker publishes himself.

## 4 · Four stages (30 s)

Sense: certificates plus forwarded SMS/WhatsApp, bank and telecom reports — one queue. Assess: isolated browser, compare
with the real page, detect the emblem, read the form — official portals never ask for a card on an inquiry page. Qualify:
evidence sealed automatically. Respond: one click, seven partners in parallel, a human in the loop. "The next four slides
show each stage with the real product."

## 5 · Sense (40 s)

Grey rows are discarded in microseconds (~10,000 names a second per core). A name scoring 40+ becomes a candidate and
lights up — here a Cyrillic "а" homograph of a tax-refund page; **every point has a reason**, which matters for the
analyst and in court. Green is the safeguard: official domains and anything under `gov.ae` are allow-listed on the raw
name, so a homograph can never pass as official and an official site can never be blocked.

## 6 · Assess (50 s)

Left: the real page from our reference gallery. Right: the candidate opened in a throw-away browser (desktop and phone).
Four independent signals: layout 93 % match, the emblem is a pixel copy, the text claims to be RTA with urgency cues, and
the form asks for card number, expiry, CVV **and the SMS one-time code**. Fused risk 90/100 → confirmed fake, reasons in
plain language. Same stage clears false positives (the gym `rta-ae-fitness.com` passes the name filter and is cleared);
parked names go into a re-check loop and are caught when they go live. Encoder is pluggable: DINOv3 when installed, a
dependency-free perceptual encoder in this demo.

## 7 · Qualify (40 s)

Collecting evidence by hand is the slow step today. SAQR seals a package the moment a fake is confirmed: 13 artefacts —
screenshots, DOM, full HAR, DNS, registration data, certificate **and the exact log entry anyone can re-fetch**, hosting
and abuse contacts, the IBANs/phone numbers on the page. Every file hashed → Merkle root → manifest time-stamped (RFC 3161,
or a clearly labelled local signature offline) → custody log. Re-verifiable offline. This is what goes to the registrar,
the CA and the prosecutor.

## 8 · Respond (45 s)

The analyst sees case, evidence and safeguards, types their name, clicks once. Fan-out, all at the same time: telecoms via
TDRA block the URL and filter the SMS pattern (**this is what cuts exposure in seconds**), browsers show a red warning,
registrar and host take the site down at the source, banks freeze the IBANs/wallets on the page, the CA revokes the
certificate, aeCERT and the imitated entity get the incident. Every request carries the evidence hashes and returns a
receipt. Safeguards are in code: allow-list re-checked server-side; nothing sent without a named human approval written
to the hash-chained audit log. Partner endpoints are simulated in this build; payloads are real.

## 9 · Results (40 s)

Real timestamps from a demo run: certificate logged → candidate after 6 s → verified and evidence sealed 7 s later →
analyst approved in under 3 min → telecom block acknowledged 1 s after. Time-to-identify is measured from the public
certificate timestamp, so anyone can recompute it. Against a conservative complaint-driven baseline (9 h) and a
takedown-only baseline (48 h) the 70 % / 50 % targets are met by construction — today's delay is waiting for complaints
and then for takedowns, and SAQR removes both waits. Say clearly: baselines are assumptions we will replace with the
organisers' historical cases.

## 10 · Constraints (35 s)

Identity: no citizen identity processed; analysts named; UAE PASS in production. Privacy: only what the attacker
publishes; reporter numbers masked and hashed; identifiers scrubbed from forwarded texts. Evidence: hashes, Merkle root,
trusted timestamp, custody, audit chain — aligned with the Trust Services law (46/2021). Law: human sign-off, allow-list in
the dispatcher, notices cite ICANN RAA 3.18, CA/B BR 4.9.1.1 and the Cybercrimes law (34/2021). It is the Antifraud-Center
model: everyone acts on one shared case.

## 11 · Live demo (3 min) — click-script

Before the session: `saqr demo` (or `saqr demo --live` with Internet), open `http://localhost:8000/docs/presentation/#/11`
or the dashboard tab. Reset via the Presenter drawer if a previous run is visible.

1. **Live Wall.** The ticker is scrolling. Press `P`, fire *"Certificate issued for rta-fines-refund.com"*.
2. The row lights up amber (score 80, reasons in the tooltip). A detection card appears and moves
   Detected → Verifying → Verified → Evidence in ~10 s. Say: "nobody's phone was involved".
3. Fire *"Citizen forwards the SMS lure"*: the report attaches to the case; a campaign opens.
4. Click **Review & block** → case page: side-by-side screenshots, signal bars, form fields in red, IOCs, evidence card
   (Merkle root, timestamp, custody). Click *Open report* if time allows.
5. **Approve & block everywhere** → modal shows the safeguards → type your name → *Approve & dispatch 7 channels*.
   Channels go sent → acknowledged; state turns **Blocked**; the exposure gauge on the Live Wall updates.
6. Back on the Live Wall (optional, if time): the gym site `rta-ae-fitness.com` is cleared; `dubaipolice-fines.online`
   is parked → monitoring; fire *"Scammer activates the parked …"* and it is caught by the re-check.

If anything stalls: the Presenter drawer has *Again* on every step, and `POST /api/demo/reset` wipes the run.

## 12 · Honest scope · next (30 s)

Say it before they ask: names with no recognisable word, wildcard certificates and free-hosting subdomains are not in the
certificate filter — they come in reactively and get the same verification and block. Connectors are simulated. Demo
encoder is perceptual; DINOv3 plugs in. Baselines are assumptions. No authentication in the MVP. Next 90 days: partner
integrations, model trained on historical cases, UAE PASS + national TSA, citizen reporting number, more sensors.

## 13 · Close (15 s)

"Catch them while they set up. Block them everywhere with one click." The ask: the organisers' historical cases to replace
our baselines, and an introduction to TDRA and one operator to wire the first real connector. شكراً.

---

## Q&A crib

* **How do you catch sites that never appear in the logs?** Reactively: forwarded SMS/WhatsApp, bank and telecom reports,
  threat feeds — same verification, same one-click block. That is where most of the exposure gain comes from; the
  certificate filter is where the time-to-identify gain comes from.
* **Why does a scammer's domain show up at all?** Browsers reject certificates that are not logged, so every CA logs them.
  Wildcard certificates hide the subdomain and meaningless names have nothing to match — we say so on slide 12.
* **What exactly is "time to identify"?** `detected_at − certificate log timestamp`. Exposure: certificate timestamp →
  first confirmed block (telecom/browser). Both recomputable from the log entry in the package. Baselines (9 h, 48 h) are
  configurable assumptions (`docs/metrics.md`).
* **Is the "AI model" real?** Four signal families are fused with documented weights and decision rules; the visual
  encoder is DINOv3/DINOv2 when installed and a dependency-free perceptual encoder in the demo (clones 0.92–0.94, unrelated
  < 0.3 on our fixtures). Training a fusion model on historical cases is the roadmap item — the interface is in place.
* **False positives?** Cheap filter is over-inclusive on purpose; verification clears them (gym demo). Nothing is blocked
  without a verdict *and* a named human. Official domains are allow-listed in the dispatcher — they cannot be blocked
  even by mistake.
* **Legally usable evidence?** SHA-256 per artefact, Merkle root, RFC 3161 token (or labelled local signature), custody
  log, append-only hash-chained audit; re-verifiable offline. Designed with the Electronic Transactions and Trust
  Services law in mind; a national TSA and UAE PASS signing replace the local fallback in production.
* **Privacy?** We observe only infrastructure the attacker publishes. Reporters' numbers are masked and hashed; identifiers
  inside messages are scrubbed; no browsing data; the isolated browser refuses internal network targets.
* **What is simulated?** Partner endpoints (registrar, host, telecoms, browsers, banks, CA, CERT) acknowledge after short
  delays; the request payloads are real and attached to every case. Everything else — CT tailing, filtering, capture,
  scoring, evidence, audit — runs for real (`saqr demo --live` uses the real global logs).
* **Scale?** Filter ~10,000 names/s per core; global feed is a few hundred certificates/s; verification ~5 s per candidate,
  parallel browsers; one node handles the country-level stream.
