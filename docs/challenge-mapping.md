# Mapping to the hackathon.ae challenge

**Track:** Pioneers · **Theme:** Digital Trust & Cyber-Secure Nation · **Challenge 6:**

> How might we enable government entities and cybersecurity teams to proactively detect, verify, and respond to
> websites, messages, domains, and digital channels impersonating official government financial services to achieve a
> 70% reduction in the time to identify fraudulent channels and a 50% reduction in the exposure period of confirmed
> impersonation attempts, under digital identity, privacy, evidentiary, and legal constraints, using historical
> impersonation cases, fraudulent links and domains, communication samples, and available threat intelligence while
> aligning with the UAE National Cybersecurity Strategy 2025-2031 and digital trust objectives?

| Challenge requirement | SAQR |
|---|---|
| **Proactively detect** websites, domains, channels | Live Certificate Transparency tailing (RFC 6962) + look-alike filter catches names at certificate issuance, before the first SMS. Reports, partner submissions and threat feeds cover channels outside the logs. |
| **Verify** whether a channel is authentic | Isolated-browser capture, visual similarity to the reference gallery (DINOv3 / perceptual), emblem reuse, page-text entity claims (EN/AR), form-field classification (card, CVV, OTP, Emirates ID), domain/certificate signals → explainable verdict with risk score. Allow-listed official properties can never be flagged. |
| **Respond** and coordinate across organisations and external providers | One-click approval fans out to registrar, host, telecom operators (via TDRA), browser blocklists, banks/CBUAE, the issuing CA and aeCERT, with receipts and acknowledgements tracked per channel. Campaign grouping acts on whole waves. |
| **Consolidate threat reports and evidence** | Every confirmed fake gets an automatic evidence package: screenshots, DOM, HAR, DNS, RDAP, certificate + CT entry, hosting, IOCs, SHA-256 per artefact, Merkle root, trusted timestamp, chain of custody, human-readable report. |
| **70% reduction in time to identify** | Identification moves from "after victims complain" to "when the certificate is logged": minutes instead of hours or days. The dashboard measures `issued_at → detected_at` per case against a configurable baseline (`docs/metrics.md`). |
| **50% reduction in exposure period** | Telecom and browser blocking is requested the moment the analyst approves, in parallel with registrar/host takedown, instead of waiting for takedown alone. The dashboard measures `issued_at → first confirmed block`. |
| **Digital identity constraints** | No citizen identity is processed. Analyst approvals are attributed and logged; in production the approval step binds to UAE PASS. |
| **Privacy constraints** | SAQR observes only what scammers publish (certificates, public pages). Reporter numbers are masked and hashed, identifiers in forwarded messages are scrubbed before storage, no browsing data of citizens is touched. |
| **Evidentiary constraints** | Hash-chained audit log; evidence manifests with SHA-256 + Merkle root; RFC 3161 time-stamp token (or clearly labelled local signature); packages re-verifiable offline with `saqr evidence verify`. Designed with the Electronic Transactions and Trust Services law (Federal Decree-Law 46/2021) in mind. |
| **Legal constraints** | Human sign-off before any block; allow-list enforced in the dispatcher; takedown notices cite ICANN RAA 3.18, CA/B Forum BR 4.9.1.1 and Federal Decree-Law 34/2021 (Combatting Rumours and Cybercrimes). |
| **Use historical cases, fraudulent links/domains, samples, threat intel** | The reference gallery and protected registry are the "historical" knowledge base; the scoring seam accepts a model trained on past cases; threat-feed and partner intake endpoints ingest fraudulent links; forwarded messages are the communication samples that build campaigns. |
| **National Cybersecurity Strategy 2025-2031 / digital trust** | Shared situational awareness across government, telecoms and banks (the Kazakhstan Antifraud Centre model applied to impersonation), measurable KPIs, and citizen participation through the reporting number. |

## Figures used in the pitch

* UAE Cyber Security Council: over 75 % of cyber breaches start with phishing or fraudulent messages; scam messages rose
  35 % in a year (as cited in the team's application).
* Today's delay: sites are usually found only after someone has lost money, and takedown means contacting registrars,
  hosts and telecom operators separately, so a fake can stay online for days.
