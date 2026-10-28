# Demo script (≈6 minutes)

Start: `saqr demo` (offline, replayed feed) or `saqr demo --live` (real Certificate Transparency logs with the demo
domains injected). Open http://localhost:8000. Press `p` for the Presenter drawer whenever you want to fire a step early.
The slide deck is served by the same node at http://localhost:8000/deck (slide 11 embeds the live dashboard); the
presenter script with timings and the click-by-click demo is `docs/presentation/presenter-notes.md`.

| t | What the audience sees | What to say |
|---|---|---|
| 0:00 | **Live Wall**: the certificate ticker scrolling (hundreds of names a minute, grey = discarded by the filter, green = official allow-listed). KPI strip, funnel, gauges at baseline. | "Every HTTPS site needs a certificate, every certificate is public within minutes. We read those logs directly — this is the real global feed." (point at the source badge: `ctlogs · 2 logs online`). |
| 0:20 | `rta-fines-refund.com` lights up amber in the ticker: *brand token rta · lure keywords fines, refund · Let's Encrypt*. A Detection card appears: Detected → Verifying. | "The scammer just got a certificate. The cheap filter saw `rta` + `fines` + `refund` and the page goes to an isolated browser — nobody's phone is involved." |
| 0:35 | Card turns red: *confirmed fake · risk 90*; thumbnail of the clone. Evidence badge appears. | "Five seconds later: layout matches the RTA fines page at 93 %, the emblem is copied, and the form asks for card number, CVV and the OTP. Evidence package is already sealed." |
| 0:50 | A citizen SMS arrives (Reports page or the live event): *RTA: your fine was overcharged… claim within 24h*. It links to the same case; a campaign `CAMP-2026-0001 · fine refund` is created. | "Sites outside the logs reach us the reactive way: forwarded SMS, bank and telecom reports. Messages cluster into campaigns, so we act on the wave, not the text." |
| 1:10 | Open the **case page**. Side-by-side: suspect vs official page; signal bars; form fields in red; timeline with durations; IOCs (WhatsApp number, e-mail). Evidence card: 13 artefacts, Merkle root, timestamp, chain of custody. Click *Open report*. | "This is what a prosecutor gets: hashes, Merkle root, RFC 3161 timestamp, the CT log entry anyone can re-fetch. No manual collection." |
| 1:50 | Click **Approve & block everywhere** → modal shows the safeguards (not allow-listed ✓, verdict, analyst name) → confirm. Channel list: telecom, browsers, registrar, host, bank, CA, aeCERT go *sent* → *acknowledged* in seconds. State → **blocked**; exposure gauge updates. | "One click. Telecom and browser blocks land in seconds, while the registrar and host work on the takedown in parallel. That is the exposure cut. A person approved it, and it is in the audit chain." |
| 2:40 | Back on the Live Wall: `salik-recharge-ae.com`, `emiratespost-redelivery.shop` arrive with their SMS variants (two parcel texts cluster together). `rta-ae-fitness.com` is flagged amber then cleared as **benign** (gym site). | "Precision matters: the filter is cheap and over-inclusive, verification clears the gym. Nothing is blocked without a verdict and a human." |
| 3:30 | `dubaipolice-fines.online` → **inactive / monitoring** (parked page). Later (presenter: fire step `s13`) the scammer activates it → the scheduled re-check catches it → confirmed. | "Scammers park names and activate later. We keep watching." |
| 4:00 | `tаx-refund-gov.com` (Cyrillic а) shows the Unicode form and the *IDN homograph* reason; a bank partner report brings in `moi-uae-fines-pay.com`, which never appeared in the logs. | "Look-alike letters, and the reactive path again." |
| 4:30 | **Reports & Campaigns**: three campaigns, sizes, lure patterns, domains, cases. **Audit**: click *Verify chain* → valid. **Registry**: test `dubai-police-fines.com` live. | "Everything is explainable and tamper-evident." |
| 5:00 | Live Wall gauges: median time-to-identify ≈ seconds vs 9 h baseline (≫70 %), median exposure ≈ a minute vs 48 h (≫50 %). | "The targets are realistic because today's delay is waiting — for complaints, then for takedowns. We remove both waits." |

Reset between runs: Presenter drawer → *Reset* (or `POST /api/demo/reset`).

**If the venue has no Internet:** `saqr demo` (replay) needs nothing external; evidence timestamps fall back to the
local signature and say so.
