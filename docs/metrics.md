# Metrics: how the 70 % and 50 % targets are measured

The dashboard computes two medians over confirmed/suspicious cases and compares them with configurable baselines.

| Metric | Definition in SAQR | Baseline (default) |
|---|---|---|
| **Time to identify (TTI)** | `detected_at − issued_at`: from the moment the certificate is logged in Certificate Transparency (the earliest public trace of the fake) to the moment SAQR creates the candidate. | `SAQR_BASELINE_TTI_HOURS = 9` — detection through victim complaints typically takes hours to days; 9 h is a deliberately conservative figure. |
| **Verification time** | `verified_at − detected_at`: isolated browser capture + analysis + evidence (typically 4–10 s). | — |
| **Exposure** | `blocked_at − issued_at` where `blocked_at` is the first acknowledgement from a channel that stops victims reaching the page (telecom block, browser blocklist, DNS RPZ). Registrar/host completion is tracked separately as `taken_down_at`. | `SAQR_BASELINE_EXPOSURE_HOURS = 48` — registrar/host takedowns alone commonly take one to several days. |

Reductions are `(baseline − median) / baseline`. The Live Wall shows both against the 70 % / 50 % targets.

**Why these definitions.** The challenge asks for *time to identify fraudulent channels* and the *exposure period of
confirmed impersonation attempts*. Anchoring both on the certificate timestamp is strict (it is the earliest time the
fake could have existed) and verifiable by anyone from the public log entry stored in the evidence package.

**Caveats.** The baselines are assumptions for the MVP, not measured UAE data; the organisers' historical cases would
replace them. In replay mode the certificate timestamp is synthetic (seconds before it appears in the feed); in `hybrid`
or `ctlogs` mode it is the real log timestamp. Simulated partner acknowledgements arrive after a few seconds; real
acknowledgement times depend on the agreements with each partner.
