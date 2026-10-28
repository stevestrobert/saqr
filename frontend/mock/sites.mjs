// Scenario content for the mock backend: official reference pages, fake-page profiles, benign/parked
// look-alikes, response connectors and lure messages. Mirrors demo/sites/*/manifest.json.

export const REFERENCES = [
  { id: 'ref_rta', name: 'RTA Dubai · Traffic Fines Inquiry & Payment', domain: 'rta.ae', entity: 'Roads and Transport Authority (Dubai)', palette: [200, 16, 46] },
  { id: 'ref_salik', name: 'Salik · Recharge Account & Toll Statement', domain: 'salik.ae', entity: 'Salik (Dubai toll)', palette: [0, 128, 128] },
  { id: 'ref_moi', name: 'Ministry of Interior · Traffic Fines Payment', domain: 'moi.gov.ae', entity: 'Ministry of Interior', palette: [0, 104, 71] },
  { id: 'ref_fta', name: 'Federal Tax Authority · VAT Refund Status', domain: 'tax.gov.ae', entity: 'Federal Tax Authority', palette: [20, 38, 80] },
  { id: 'ref_epost', name: 'Emirates Post · Customs Duty & Delivery Fee Payment', domain: 'emiratespost.ae', entity: 'Emirates Post', palette: [196, 30, 58] },
  { id: 'ref_dubaipolice', name: 'Dubai Police · Traffic Fines & Services', domain: 'dubaipolice.gov.ae', entity: 'Dubai Police', palette: [0, 98, 65] },
  { id: 'ref_uaepass', name: 'UAE PASS · Sign in', domain: 'uaepass.ae', entity: 'UAE PASS', palette: [24, 24, 28] },
  { id: 'ref_dewa', name: 'DEWA · Bill Payment', domain: 'dewa.gov.ae', entity: 'Dubai Electricity and Water Authority', palette: [0, 150, 136] },
];

const f = (name, label, type, category, sensitivity, extra = {}) => ({ name, id: name, type, placeholder: extra.placeholder ?? '', label, autocomplete: extra.autocomplete ?? '', maxlength: extra.maxlength ?? null, category, sensitivity });
const CARD = [
  f('card_name', 'Name on card', 'text', 'cardholder', 1, { autocomplete: 'cc-name' }),
  f('card_number', 'Card number', 'text', 'card_number', 3, { autocomplete: 'cc-number', maxlength: 19, placeholder: '0000 0000 0000 0000' }),
  f('expiry', 'Expiry (MM/YY)', 'text', 'expiry', 2, { autocomplete: 'cc-exp', maxlength: 5 }),
  f('cvv', 'CVV', 'password', 'cvv', 3, { autocomplete: 'cc-csc', maxlength: 4 }),
];
const EID = f('emirates_id', 'Emirates ID', 'text', 'emirates_id', 3, { placeholder: '784-XXXX-XXXXXXX-X', maxlength: 18 });
const OTP = f('otp', 'One-time password (SMS)', 'text', 'otp', 3, { maxlength: 6, autocomplete: 'one-time-code' });

export const FAKES = {
  'rta-fines-refund.com': {
    title: 'Traffic Fines Refund — RTA Dubai',
    entityId: 'rta',
    ref: 'ref_rta',
    verdict: 'confirmed_fake',
    risk: 94,
    confidence: 0.96,
    components: { visual: 0.93, logo: 0.97, text: 0.88, form: 1.0, domain: 0.86 },
    similarity: 0.93,
    ssim: 0.81,
    logoScore: 0.97,
    lure: 'Refund of overpaid fine AED 320 — claim within 24 hours',
    lang: 'en',
    text: 'Government of Dubai · Roads and Transport Authority · هيئة الطرق والمواصلات\nTraffic Fines Refund\nOur records show an overpayment of AED 320.00 on traffic fine 4471-2026. The refund will be forfeited if not claimed within 24 hours.\nStep 1 — Verify your identity: Full name, Emirates ID, Mobile number.\nStep 2 — Refund card: Card number, Expiry, CVV. Enter the one-time password sent to your mobile to receive the refund.\nSecure payment · 256-bit SSL · Need help? WhatsApp +971 50 000 0001\n© 2026 Roads and Transport Authority. All rights reserved. حكومة دبي',
    textSignals: { brand_mentions: ['RTA', 'Roads and Transport Authority', 'هيئة الطرق والمواصلات'], payment_terms: ['refund', 'card number', 'cvv', 'expiry', 'one-time password', 'secure payment'], urgency_terms: ['within 24 hours', 'will be forfeited'], arabic_ratio: 0.09, gov_claims: ['government of dubai', 'roads and transport authority'], score: 0.88 },
    fields: [f('full_name', 'Full name', 'text', 'name', 1, { autocomplete: 'name' }), EID, f('mobile', 'Mobile number', 'tel', 'phone', 1, { autocomplete: 'tel' }), ...CARD, OTP],
    formAction: 'https://rta-fines-refund.com/api/refund/submit',
    submit: 'Claim refund',
    iocs: { whatsapp: ['971500000001'], phones: ['+971500000001'] },
    infra: { ip: '164.90.212.77', asn: 'AS14061', org: 'DigitalOcean, LLC', country: 'NL', registrar: 'NameCheap, Inc.', createdDaysAgo: 2, ns: ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'], hostAbuse: 'abuse@digitalocean.com', regAbuse: 'abuse@namecheap.com' },
    issuer: "Let's Encrypt (R12)",
    log: 'Google Argon 2026h2',
    explanations: [
      'Page is a near-exact clone of rta.ae (visual similarity 0.93, SSIM 0.81) and reuses the RTA logo verbatim.',
      'Form collects card number, expiry, CVV and a one-time password — the official page never asks for card details (payments go through a gateway).',
      'Refund lure with a 24-hour deadline; text claims to be the Government of Dubai.',
      "Domain combines the RTA brand with 'fines' and 'refund'; certificate issued 2 minutes before detection by a free CA.",
    ],
    recommended: 'Block everywhere and request suspension; notify RTA brand protection.',
  },
  'salik-recharge-ae.com': {
    title: 'Salik Recharge — Account Top-up',
    entityId: 'salik',
    ref: 'ref_salik',
    verdict: 'confirmed_fake',
    risk: 91,
    confidence: 0.95,
    components: { visual: 0.95, logo: 0.96, text: 0.79, form: 0.92, domain: 0.8 },
    similarity: 0.95,
    ssim: 0.86,
    logoScore: 0.96,
    lure: 'Salik balance negative (AED −45.00); recharge now to avoid a AED 100 fine',
    lang: 'en',
    text: 'Salik · سالك\nYour Salik account balance is negative: AED -45.00. Recharge now to avoid a AED 100 fine per crossing.\nRecharge amount: AED 50 · AED 100 · AED 200\nPay by card — Name on card, Card number, Expiry, CVV. Pay now.\nSalik Company PJSC © 2026',
    textSignals: { brand_mentions: ['Salik', 'سالك'], payment_terms: ['recharge', 'balance', 'card number', 'cvv', 'pay now'], urgency_terms: ['avoid a fine', 'recharge now'], arabic_ratio: 0.04, gov_claims: ['salik'], score: 0.79 },
    fields: [f('amount', 'Recharge amount', 'number', 'amount', 0), ...CARD],
    formAction: 'https://salik-recharge-ae.com/pay.php',
    submit: 'Pay now',
    iocs: {},
    infra: { ip: '84.32.84.117', asn: 'AS47583', org: 'Hostinger International', country: 'LT', registrar: 'NameSilo, LLC', createdDaysAgo: 1, ns: ['ns1.dns-parking.com', 'ns2.dns-parking.com'], hostAbuse: 'abuse@hostinger.com', regAbuse: 'abuse@namesilo.com' },
    issuer: 'ZeroSSL (ZeroSSL RSA Domain Secure Site CA)',
    log: 'Cloudflare Nimbus 2026',
    explanations: ['Near-exact clone of salik.ae (visual similarity 0.95) with the Salik logo.', 'Card number and CVV collected on-page; the official recharge redirects to a payment gateway.', 'Fake negative-balance pressure with a fine threat.', "Domain is the Salik brand plus 'recharge' and a 'uae' cue, registered yesterday."],
    recommended: 'Block everywhere and request suspension.',
  },
  'xn--tx-refund-gov-w1k.com': {
    title: 'VAT Refund Verification — Federal Tax Authority',
    entityId: 'fta',
    ref: 'ref_fta',
    verdict: 'confirmed_fake',
    risk: 96,
    confidence: 0.97,
    components: { visual: 0.91, logo: 0.94, text: 0.86, form: 1.0, domain: 1.0 },
    similarity: 0.91,
    ssim: 0.78,
    logoScore: 0.94,
    lure: 'VAT refund of AED 1,250.00 is ready; verify your card to receive it',
    lang: 'en',
    text: 'الهيئة الاتحادية للضرائب · Federal Tax Authority · United Arab Emirates\nVAT Refund Verification\nA VAT refund of AED 1,250.00 has been approved for your TRN. To receive the refund, verify your tax registration number, IBAN and the card linked to your account within 48 hours.\nTRN · IBAN · Name on card · Card number · Expiry · CVV\nVerify and receive refund\ntаx-refund-gov.com — Official e-Services portal',
    textSignals: { brand_mentions: ['Federal Tax Authority', 'الهيئة الاتحادية للضرائب'], payment_terms: ['vat refund', 'iban', 'card number', 'cvv', 'refund'], urgency_terms: ['within 48 hours'], arabic_ratio: 0.08, gov_claims: ['federal tax authority', 'official portal'], score: 0.86 },
    fields: [f('trn', 'Tax Registration Number (TRN)', 'text', 'other', 2, { maxlength: 15 }), f('iban', 'IBAN', 'text', 'iban', 2, { placeholder: 'AE00 0000 0000 0000 0000 000' }), ...CARD],
    formAction: 'https://xn--tx-refund-gov-w1k.com/verify',
    submit: 'Verify and receive refund',
    iocs: {},
    infra: { ip: '95.217.134.22', asn: 'AS24940', org: 'Hetzner Online GmbH', country: 'FI', registrar: 'Porkbun LLC', createdDaysAgo: 0, ns: ['curitiba.ns.porkbun.com', 'fortaleza.ns.porkbun.com'], hostAbuse: 'abuse@hetzner.com', regAbuse: 'abuse@porkbun.com' },
    issuer: "Let's Encrypt (R12)",
    log: "Let's Encrypt Oak 2026h2",
    explanations: ["IDN homograph: 'tаx-refund-gov.com' is spelled with a Cyrillic 'а' (U+0430) so it renders like a Latin name.", 'Clone of tax.gov.ae (visual similarity 0.91) reusing the FTA emblem.', 'Collects TRN, IBAN and full card details — the FTA pays refunds to a registered IBAN and never asks for card data.', 'Certificate issued minutes ago by a free CA for a domain registered today.'],
    recommended: 'Block everywhere, request CA revocation and registrar suspension.',
  },
  'dubaipolice-fines.online': {
    title: 'Dubai Police — Traffic Fines Payment',
    entityId: 'dubaipolice',
    ref: 'ref_moi',
    verdict: 'confirmed_fake',
    risk: 89,
    confidence: 0.93,
    components: { visual: 0.88, logo: 0.9, text: 0.84, form: 1.0, domain: 0.78 },
    similarity: 0.88,
    ssim: 0.74,
    logoScore: 0.9,
    lure: 'Unpaid traffic fines (AED 1,120.00); pay now to avoid a travel ban',
    lang: 'en',
    text: 'شرطة دبي · Dubai Police · Government of Dubai\nTraffic Fines Payment\nYou have 2 unpaid traffic fines totalling AED 1,120.00. Pay within 24 hours to avoid a travel ban and vehicle impoundment.\nEmirates ID · Name on card · Card number · Expiry · CVV\nPay fines now\nBank transfer also accepted: IBAN AE07 0331 2345 6789 0123 456',
    textSignals: { brand_mentions: ['Dubai Police', 'شرطة دبي'], payment_terms: ['fines', 'pay now', 'card number', 'cvv', 'iban', 'bank transfer'], urgency_terms: ['within 24 hours', 'travel ban'], arabic_ratio: 0.06, gov_claims: ['dubai police', 'government of dubai'], score: 0.84 },
    fields: [EID, ...CARD],
    formAction: 'https://dubaipolice-fines.online/checkout',
    submit: 'Pay fines now',
    iocs: { ibans: ['AE070331234567890123456'] },
    infra: { ip: '51.75.164.9', asn: 'AS16276', org: 'OVH SAS', country: 'FR', registrar: 'GoDaddy.com, LLC', createdDaysAgo: 3, ns: ['ns55.domaincontrol.com', 'ns56.domaincontrol.com'], hostAbuse: 'abuse@ovh.net', regAbuse: 'abuse@godaddy.com' },
    issuer: "Let's Encrypt (R12)",
    log: 'Google Xenon 2026h2',
    explanations: ['Clones the moi.gov.ae fines layout and reuses the MOI emblem but relabels it as Dubai Police — the logo does not match the claimed entity.', 'Harvests Emirates ID plus full card details; an IBAN for bank transfer is shown on the page.', 'Travel-ban threat with a 24-hour deadline.', "Brand token 'dubaipolice' with 'fines' on an abuse-prone .online TLD."],
    recommended: 'Block everywhere; send IBAN to the receiving bank for freezing.',
  },
  'emiratespost-redelivery.shop': {
    title: 'Emirates Post — Parcel Redelivery',
    entityId: 'emiratespost',
    ref: 'ref_epost',
    verdict: 'confirmed_fake',
    risk: 92,
    confidence: 0.95,
    components: { visual: 0.94, logo: 0.95, text: 0.82, form: 0.92, domain: 0.82 },
    similarity: 0.94,
    ssim: 0.83,
    logoScore: 0.95,
    lure: 'Parcel could not be delivered; pay AED 11.50 redelivery fee to reschedule',
    lang: 'en',
    text: 'Emirates Post · بريد الإمارات\nYour parcel EP7781204AE could not be delivered because the address is incomplete. Pay the AED 11.50 redelivery fee within 48 hours to reschedule.\nFull name · Address · City · Emirate · Card number · Expiry · CVV\nReschedule delivery\nQuestions? +971 52 118 4420',
    textSignals: { brand_mentions: ['Emirates Post', 'بريد الإمارات'], payment_terms: ['redelivery', 'delivery fee', 'card number', 'cvv'], urgency_terms: ['could not be delivered', 'within 48 hours'], arabic_ratio: 0.05, gov_claims: ['emirates post'], score: 0.82 },
    fields: [f('full_name', 'Full name', 'text', 'name', 1), f('address', 'Address', 'text', 'other', 1, { autocomplete: 'street-address' }), f('city', 'City', 'text', 'other', 0), f('emirate', 'Emirate', 'select', 'other', 0), ...CARD],
    formAction: 'https://emiratespost-redelivery.shop/api/pay',
    submit: 'Reschedule delivery',
    iocs: { phones: ['+971521184420'] },
    infra: { ip: '47.254.173.60', asn: 'AS45102', org: 'Alibaba (US) Technology Co.', country: 'US', registrar: 'Dynadot, LLC', createdDaysAgo: 4, ns: ['ns1.dynadot.com', 'ns2.dynadot.com'], hostAbuse: 'abuse@alibaba-inc.com', regAbuse: 'abuse@dynadot.com' },
    issuer: 'Google Trust Services (WE1)',
    log: 'Google Argon 2026h2',
    explanations: ['Near-exact clone of emiratespost.ae (visual similarity 0.94) including header, palette and footer.', 'Collects address and full card details for an AED 11.50 "redelivery fee" — a classic parcel scam.', "Brand token 'emiratespost' with 'redelivery' on a .shop TLD."],
    recommended: 'Block everywhere and request suspension; notify Emirates Post.',
  },
  'moi-uae-fines-pay.com': {
    title: 'MOI UAE — Pay Traffic Fines Online',
    entityId: 'moi',
    ref: 'ref_moi',
    verdict: 'suspicious',
    risk: 61,
    confidence: 0.72,
    components: { visual: 0.58, logo: 0.0, text: 0.81, form: 0.45, domain: 0.74 },
    similarity: 0.58,
    ssim: 0.41,
    logoScore: 0,
    lure: 'Pay your MOI traffic fines online — fast and secure',
    lang: 'en',
    text: 'Pay UAE Traffic Fines Online — Ministry of Interior fines lookup\nEnter your Emirates ID or traffic file number and mobile number to see unpaid fines. We will contact you with payment instructions.\nEmirates ID · Mobile number\nCheck my fines\nThis website is not affiliated with… (text cut off)',
    textSignals: { brand_mentions: ['Ministry of Interior', 'MOI'], payment_terms: ['fines', 'payment'], urgency_terms: [], arabic_ratio: 0.0, gov_claims: ['ministry of interior'], score: 0.81 },
    fields: [EID, f('mobile', 'Mobile number', 'tel', 'phone', 1)],
    formAction: 'https://moi-uae-fines-pay.com/lookup',
    submit: 'Check my fines',
    iocs: {},
    infra: { ip: '172.67.188.14', asn: 'AS13335', org: 'Cloudflare, Inc. (proxy)', country: 'US', registrar: 'Tucows Domains Inc.', createdDaysAgo: 11, ns: ['ada.ns.cloudflare.com', 'eric.ns.cloudflare.com'], hostAbuse: 'abuse@cloudflare.com', regAbuse: 'abuse@tucows.com' },
    issuer: 'Cloudflare, Inc. (Cloudflare TLS Issuing ECC CA 1)',
    log: 'Cloudflare Nimbus 2026',
    explanations: ['Different layout from moi.gov.ae (visual similarity 0.58) and no reused logo, but the text claims to be the Ministry of Interior.', 'Collects Emirates ID and mobile number only — no card fields yet; may be a lead-harvesting stage.', "Brand token 'moi' (ambiguous) combined with 'uae', 'fines' and 'pay'."],
    recommended: 'Analyst review; keep under watch for a payment step.',
  },
  'uaepass-verify.top': {
    title: 'UAE PASS — Verify your account',
    entityId: 'uaepass',
    ref: 'ref_uaepass',
    verdict: 'confirmed_fake',
    risk: 88,
    confidence: 0.92,
    components: { visual: 0.9, logo: 0.93, text: 0.76, form: 0.95, domain: 0.84 },
    similarity: 0.9,
    ssim: 0.8,
    logoScore: 0.93,
    lure: 'Your UAE PASS will be suspended; verify your identity within 24 hours',
    lang: 'en',
    text: 'UAE PASS · الهوية الرقمية\nYour UAE PASS account will be suspended within 24 hours. Verify your identity to keep access to government services.\nEmirates ID · Password · One-time password\nVerify account',
    textSignals: { brand_mentions: ['UAE PASS', 'الهوية الرقمية'], payment_terms: ['one-time password', 'verify'], urgency_terms: ['will be suspended', 'within 24 hours'], arabic_ratio: 0.07, gov_claims: ['uae pass', 'government services'], score: 0.76 },
    fields: [EID, f('password', 'Password', 'password', 'password', 3, { autocomplete: 'current-password' }), OTP],
    formAction: 'https://uaepass-verify.top/auth',
    submit: 'Verify account',
    iocs: {},
    infra: { ip: '185.199.229.14', asn: 'AS9009', org: 'M247 Europe SRL', country: 'RO', registrar: 'NameCheap, Inc.', createdDaysAgo: 1, ns: ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'], hostAbuse: 'abuse@m247.com', regAbuse: 'abuse@namecheap.com' },
    issuer: "Let's Encrypt (R12)",
    log: 'Google Argon 2026h2',
    explanations: ['Clone of the UAE PASS sign-in page (visual similarity 0.90) with the UAE PASS logo.', 'Collects Emirates ID, password and OTP — full credential takeover of the national digital identity.', "Brand token 'uaepass' with 'verify' on an abuse-prone .top TLD, registered yesterday."],
    recommended: 'Block everywhere; notify TDRA / UAE PASS operations.',
  },
};

/** Parked domains: inactive when first captured; the scenario "activates" one into a card-harvesting clone. */
export const PARKED = {
  'salik-toll-renewal.site': { entityId: 'salik', ref: 'ref_salik', activatedAs: { ...FAKES['salik-recharge-ae.com'], title: 'Salik Toll Renewal — Pay Outstanding Tolls', lure: 'Outstanding toll AED 36.00 — renew before your plate is blocked', risk: 90 } },
};

/** Look-alikes that turn out benign. */
export const BENIGN = {
  'rta-ae-fitness.com': { title: 'RTA Fitness — Real Time Athletics, Al Quoz', verdict: 'suspicious', risk: 44, confidence: 0.61, components: { visual: 0.12, logo: 0.0, text: 0.08, form: 0.3, domain: 0.62 }, text: 'Real Time Athletics (RTA Fitness) — gym in Al Quoz, Dubai. Memberships from AED 199/month. Book a free trial: Name, Email, Phone.', fields: [f('name', 'Name', 'text', 'name', 1), f('email', 'Email', 'email', 'email', 1), f('phone', 'Phone', 'tel', 'phone', 1)], palette: [232, 118, 30], explanations: ['Domain contains the RTA brand token with a UAE cue, but the page is a gym (Real Time Athletics).', 'No government claims, no payment fields; only a trial-booking form.', 'Visual similarity to rta.ae is 0.12.'], infra: { ip: '104.21.44.18', asn: 'AS13335', org: 'Cloudflare, Inc. (proxy)', country: 'US', registrar: 'GoDaddy.com, LLC', createdDaysAgo: 812 } },
  'nol-card-balance.net': { title: 'Nol Card Balance Checker (unofficial)', verdict: 'benign', risk: 18, confidence: 0.84, components: { visual: 0.21, logo: 0.0, text: 0.22, form: 0.1, domain: 0.4 }, text: 'Unofficial Nol card balance guide. This site is not affiliated with RTA. Learn how to check your Nol balance via the official RTA app or at any metro station.', fields: [], palette: [40, 94, 180], explanations: ['Informational page with an explicit non-affiliation notice.', 'No forms, no payment vocabulary beyond "balance".', 'Visual similarity to rta.ae is 0.21.'], infra: { ip: '198.185.159.145', asn: 'AS53831', org: 'Squarespace, Inc.', country: 'US', registrar: 'Squarespace Domains', createdDaysAgo: 1460 } },
};

export const CONNECTORS = [
  { channel: 'registrar', name: 'Registrar abuse desk', description: 'Suspension request to the sponsoring registrar (RDAP abuse contact) with the sealed evidence package attached.', targets: ['sponsoring registrar (RDAP abuse contact)'], mode: 'simulate' },
  { channel: 'hosting', name: 'Hosting provider abuse', description: 'Takedown request to the abuse contact of the hosting ASN.', targets: ['hosting ASN abuse contact'], mode: 'simulate' },
  { channel: 'telecom', name: 'Telecom operators', description: 'URL blocking on mobile networks and SMS-sender filtering at the national operators.', targets: ['e& (Etisalat)', 'du'], mode: 'simulate' },
  { channel: 'browser', name: 'Browser blocklists', description: 'Social-engineering submission to browser safe-browsing services.', targets: ['Google Safe Browsing', 'Microsoft SmartScreen'], mode: 'simulate' },
  { channel: 'bank', name: 'Banks & payment providers', description: 'Freeze requests for IBANs and wallets shown on the page; CBUAE fraud reporting otherwise.', targets: ['receiving bank fraud desk', 'CBUAE fraud reporting'], mode: 'simulate' },
  { channel: 'certificate_authority', name: 'Certificate authority', description: 'Revocation request to the issuing CA with the certificate fingerprint and evidence.', targets: ["Let's Encrypt", 'ZeroSSL', 'Google Trust Services', 'Sectigo'], mode: 'simulate' },
  { channel: 'national_cert', name: 'National CERT', description: 'Incident report to aeCERT (TDRA) for national coordination and sector-wide alerts.', targets: ['aeCERT (TDRA)'], mode: 'simulate' },
];

export const ENTITY_SHORT = { rta: 'RTA', salik: 'Salik', dubaipolice: 'Dubai Police', moi: 'MOI', fta: 'FTA', emiratespost: 'Emirates Post', uaepass: 'UAE PASS', dewa: 'DEWA', mof: 'MoF', icp: 'ICP', mohre: 'MOHRE', tamm: 'TAMM', adpolice: 'Abu Dhabi Police' };

export const BANKS = { '0331': 'Emirates NBD', '0260': 'Emirates NBD', '0030': 'Abu Dhabi Commercial Bank', '0350': 'Mashreq Bank', '0033': 'First Abu Dhabi Bank', '0400': 'Dubai Islamic Bank', '0240': 'RAKBANK' };
export const bankForIban = (iban) => BANKS[iban.replace(/\s/g, '').slice(4, 8)] ?? 'receiving bank';

/** Lure kind for campaign naming. */
export function lureKind(text) {
  const t = text.toLowerCase();
  if (/refund|استرداد/.test(t) && /vat|tax|ضريب/.test(t)) return 'VAT refund';
  if (/refund|استرداد/.test(t)) return 'refund';
  if (/parcel|deliver|customs|shipment|شحن|توصيل/.test(t)) return 'parcel redelivery';
  if (/recharge|balance|toll|رصيد|شحن/.test(t)) return 'toll recharge';
  if (/fine|violation|penalty|مخالف|غرام/.test(t)) return 'traffic-fine';
  if (/visa|residency|emirates id|إقامة/.test(t)) return 'visa fee';
  if (/login|verify|pass|suspend|تعليق|تحقق/.test(t)) return 'credential';
  return 'payment';
}
