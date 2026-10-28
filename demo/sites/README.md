# SAQR demo fixtures — `demo/sites/`

Static, self-contained HTML fixtures used as **local test data** for SAQR's
phishing-detection pipeline (hackathon MVP — *Digital Trust & Cyber-Secure Nation*).

They are organised into four kinds:

- **`official/`** — fictional "official" UAE government payment portals. These form the
  **reference gallery** the detector compares incoming pages against.
- **`fake/`** — scam clones of those portals. These are what the detector must **catch**.
- **`benign/`** — legitimate-looking unrelated businesses whose names collide with
  keywords (false-positive controls).
- **`parked/`** — a generic domain-parking placeholder.

## Safety notes

- **Localhost only.** These pages are served by the demo server on localhost for testing.
  Nothing here is published or deployed.
- **Fictional replicas.** Every file begins with an HTML comment and carries
  `<meta name="saqr-demo-fixture" content="official|fake|benign|parked">`. They are not
  affiliated with any government entity.
- **No real logos or trademarked artwork.** Every emblem is an **original, generic mark
  drawn with inline SVG** — a soaring falcon, a shield/crest, balance scales, a toll
  gantry, an envelope, an abstract road. No official crest or artwork is used.
- **Names are text only.** Entity and service names (RTA, Salik, Federal Tax Authority,
  Ministry of Interior, Emirates Post, Dubai Police, etc.) appear only as text, because
  the detector's job is to recognise *impersonation of those services*.
- **Synthetic indicators.** All phone numbers, WhatsApp numbers, IBANs and reference
  numbers are obviously fake.
- **Inert & offline.** Every form uses `action="#" method="post" onsubmit="return false"`.
  No page issues any external network request: all CSS and SVG are inline and fonts come
  from the system font stack. Each page is responsive (1280px desktop + 390px mobile),
  bilingual (English/Arabic) and under ~40 KB.

## How the pipeline uses these fixtures

### `#brand-logo` (logo template crop)
Every **official** page, and every **clone that copies an official layout**, contains
**exactly one** inline `<svg id="brand-logo">` in the header (~44–64px tall). The pipeline
crops this element as the logo template.

- Clones **reuse the same emblem SVG as the official page they copy** (scammers copy the
  logo). For example `fake/dubaipolice-fines.online` embeds the Ministry of Interior
  falcon **verbatim** while relabelling the header text as "Dubai Police" — a logo that
  does not match the claimed entity.
- The one fake that does **not** copy an official layout, `fake/moi-uae-fines-pay.com`,
  deliberately has **no `#brand-logo`** — it uses a different generic crest instead.

### `manifest.json` (metadata sidecar)
Each page has a `manifest.json` next to it:

| field | meaning |
|---|---|
| `domain`, `kind`, `title` | identity of the fixture |
| `entity`, `entity_ar`, `service` | the (impersonated) service, EN + AR |
| `official_domain` | the protected domain this page belongs to or imitates (omitted for benign/parked) |
| `clone_of` | *fakes only* — the official fixture directory it copies |
| `lure` | *fakes only* — the social-engineering hook |
| `collects` | *fakes only* — the sensitive fields the form harvests |
| `iocs` | *fakes only* — phones / IBANs / WhatsApp numbers shown on the page (synthetic) |
| `notes` | free text |

## All sites

| Path | Kind | Clone of | Form collects / note |
|---|---|---|---|
| `official/rta.ae` | official | — | Plate (emirate+code+number), traffic code, licence. Looks up a fine (AED 500) → secure gateway. **No card fields.** |
| `official/salik.ae` | official | — | Salik account/tag + recharge amount. Shows balance + toll statement → secure gateway. **No card fields.** |
| `official/tax.gov.ae` | official | — | TRN + refund reference. Shows VAT refund status paid to IBAN. **No card fields.** |
| `official/moi.gov.ae` | official | — | Emirates ID, traffic file, plate. Lists fines → secure gateway. **No card fields.** |
| `official/emiratespost.ae` | official | — | Tracking number. Shows shipment + customs duty (AED 42) → secure gateway. **No card fields.** |
| `fake/rta-fines-refund.com` | fake | `rta.ae` | full name, Emirates ID, mobile, **card / expiry / CVV**, then **OTP**. Refund lure + 24h countdown; WhatsApp IOC. |
| `fake/salik-recharge-ae.com` | fake | `salik.ae` | cardholder, **card / expiry / CVV**. "Negative balance, avoid AED 100 fine." |
| `fake/emiratespost-redelivery.shop` | fake | `emiratespost.ae` | name, address, **card / expiry / CVV**. AED 11.50 redelivery-fee scam. |
| `fake/moi-uae-fines-pay.com` | fake | — (impersonates `moi.gov.ae`) | cardholder, **card / expiry / CVV** + IBAN & phone IOCs. Generic template, **no `#brand-logo`**. |
| `fake/xn--tx-refund-gov-w1k.com` | fake | `tax.gov.ae` | TRN, IBAN, cardholder, **card / expiry / CVV**. Homoglyph domain = `tаx-refund-gov.com` (Cyrillic "а"). |
| `fake/dubaipolice-fines.online` | fake | `moi.gov.ae` | Emirates ID, cardholder, **card / expiry / CVV**. MOI layout + falcon relabelled "Dubai Police". |
| `benign/finesse-payroll.com` | benign | — | name, company, email. Payroll SaaS; contains tokens "fines" / "pay". No card, no gov styling. |
| `benign/rta-ae-fitness.com` | benign | — | name, phone. Gym in Al Quoz; contains tokens "rta" / "ae". No card, no gov styling. |
| `parked/dubaipolice-fines.online` | parked | — | none. Registrar "coming soon" placeholder (same domain later goes live as the fake above). |

## Directory layout

```
demo/sites/
  README.md
  official/<domain>/index.html + manifest.json
  fake/<domain>/index.html + manifest.json
  benign/<domain>/index.html + manifest.json
  parked/<domain>/index.html + manifest.json
```
