# SAQR — 3-minute pitch script (+ 2 minutes Q&A)

Deck: `docs/presentation/index.html` opens in the 3-minute cut by default (7 slides); the PDF of this cut is
`SAQR-pitch.pdf`. The same text is in the deck's `N` panel. About 430 words — speak briskly, do not add anything.
Click once per slide; the animations run by themselves.

| # | Slide | Say | Time |
|---|---|---|---|
| 1 | Title | SAQR means falcon. It catches fake government payment pages while they are being set up, and lets one analyst block them everywhere with one click. | 0:10 |
| 2 | Problem | Today a fake fines page is found after the money is gone. The scammer registers a look-alike name, gets a free certificate, sends an SMS wave, and victims type their card number, CVV and one-time code. Complaints arrive hours or days later, and takedown means calling the registrar, the host and the telecoms one by one. The page stays up for days. | 0:35 |
| 3 | Insight | Our insight: scammers publish their own early warning. Every convincing fake needs HTTPS, and every certificate must be written to public Certificate Transparency logs before browsers trust it. So the look-alike name appears in a world-readable stream, usually before the first SMS goes out. SAQR reads that stream live — about 150 certificates a second from two Google logs in our tests — and a cheap, explainable filter keeps roughly one name in three thousand. Nothing touches citizens: no phones, no taps, only what the attacker publishes. | 1:10 |
| 4 | Assess | Each candidate opens in a throw-away browser. SAQR compares it with the real page, finds the copied emblem, reads the text, and reads what the form asks for — official portals never ask for a card or an OTP on an inquiry page. Four signals fuse into a risk score with reasons in plain language: here 90 out of 100, confirmed fake. The same step clears false positives, like a gym with "rta" in its name. And the evidence package is sealed automatically: screenshots, code, DNS, certificate, hashes, Merkle root, trusted timestamp. | 1:45 |
| 5 | Respond | Then one click. A named analyst approves, and the request fans out to seven partners at once: telecoms block the URL and filter the SMS, browsers warn, the registrar and host take the site down, banks freeze the accounts on the page, the CA revokes the certificate, aeCERT gets the incident. The safeguards are in code: official domains are allow-listed and re-checked at dispatch, nothing goes out without a human, and every step is in a hash-chained audit log. | 2:20 |
| 6 | Results | In the demo the pipeline takes seconds to identify and about three minutes to block, including the human. Against a complaint-driven baseline of nine hours and a takedown baseline of forty-eight, that is far past the 70 and 50 percent targets. The baselines are assumptions we want to replace with your historical cases, and the partner connectors are simulated in this build. | 2:45 |
| 7 | Close | Catch them while they set up. Block them everywhere with one click. We are asking for historical cases and an introduction to one telecom operator. Thank you. | 2:55 |

If you are running over at slide 4, drop the last sentence of slides 4 and 5 (evidence list, safeguards) — they come
back in Q&A anyway.

## Q&A — 2 minutes, answer in one breath

* **What about fakes that never show up in the logs?** Meaningless names, wildcard certificates, free-hosting
  subdomains: they come in reactively — forwarded SMS and WhatsApp, bank and telecom reports — and get the same
  verification, evidence and one-click block. The certificate feed gives the time-to-identify gain; the one-click
  response gives the exposure gain.
* **Is it real or a mock-up?** Everything except the partner endpoints runs for real: live CT log tailing, the filter,
  the isolated browser, the scoring, the evidence package with RFC 3161 timestamp, the audit chain. Connectors return
  simulated receipts; the payloads they would send are real and attached to every case.
* **False positives / could it block a real site?** The name filter is deliberately over-inclusive; verification clears
  the rest (the gym). Official domains and everything under gov.ae are allow-listed on the raw name and re-checked at
  dispatch, so the product cannot block them even by mistake; a human approves every block.
* **Privacy?** We only look at what the attacker publishes: certificates and public web pages. No traffic, no phones.
  Reporter numbers are masked and hashed, identifiers in forwarded texts are scrubbed before storage.
* **Legally usable evidence?** SHA-256 per artefact, Merkle root, trusted timestamp, chain of custody, append-only
  audit; anyone can re-verify offline. UAE PASS signing and a national timestamping authority replace the local
  fallbacks in production.
* **Is the AI real?** Four signal families fused with documented weights; the visual encoder is DINOv3/DINOv2 when
  installed and a dependency-free perceptual encoder in the demo. Numbers so far are from our own fixture pages;
  training on real historical cases is the first roadmap item.
* **What do you need?** The organisers' historical cases to replace our baselines, and an introduction to TDRA and one
  operator to wire the first real connector.

Backup if a judge wants to see it: the dashboard runs locally (`make demo`, `http://localhost:8000`), and the 13-slide
version of the deck is at `?full=1` (slide 11 embeds the live dashboard).
