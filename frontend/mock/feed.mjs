// Synthetic certificate-transparency background (port of saqr/sensing/ct/replay.py).
import { createHash } from 'node:crypto';

const WORDS = (
  'alpha beta cedar delta ember falcon garden harbor island jasper kite lumen maple nova orbit pixel quartz river ' +
  'sierra tango umber violet willow xenon yonder zephyr atlas bloom canvas dune echo forge grove hazel iris juno ' +
  'koala lotus mesa nimbus opal pearl quill ridge sage tide ultra vista wave yarrow zinc aero brick cloud data ' +
  'edge flux glow hub ion jet kernel loop meta node onyx peak quest rail stack trail unit vault wire axis byte ' +
  'core dash eon frame grid hive index joint key lane mode nest oak port rune spark tile urban vine web yard ' +
  'bakery bistro cafe clinic dental fitness florist garage hotel kitchen laundry market pharmacy salon studio ' +
  'tailor travel yoga academy agency capital consulting digital global holdings industries logistics media ' +
  'partners realty solutions systems ventures works marina palm beach desert oasis souk falconry pearl coral ' +
  'apartments properties motors trading electronics furniture fashion jewellery perfume carpets textiles'
).split(' ');
const FIRST_NAMES = 'ahmed sara omar fatima khalid mariam yousef layla hamad noor ali hessa rashid aisha salem'.split(' ');
const TLDS = [...Array(40).fill('com'), ...Array(6).fill('net'), ...Array(5).fill('org'), ...Array(4).fill('io'), ...Array(5).fill('ae'), ...Array(3).fill('co.uk'), ...Array(3).fill('de'), ...Array(3).fill('xyz'), 'shop', 'shop', 'app', 'app', 'dev', 'dev', 'online', 'online', 'store', 'cloud', 'in', 'fr', 'nl', 'sa', 'eg', 'top', 'site', 'me'];
const SUBS = ['www', 'api', 'app', 'mail', 'cpanel', 'webmail', 'shop', 'staging', 'dev', 'portal', 'my', 'cdn', 'admin', 'm', 'blog', 'autodiscover'];
const ISSUERS = [
  ["Let's Encrypt (R12)", 46],
  ['Google Trust Services (WE1)', 18],
  ['ZeroSSL (ZeroSSL RSA Domain Secure Site CA)', 8],
  ['DigiCert Inc (DigiCert Global G2 TLS RSA SHA256 2020 CA1)', 7],
  ['Sectigo Limited (Sectigo RSA Domain Validation Secure Server CA)', 7],
  ['GoDaddy.com, Inc.', 4],
  ['Amazon (Amazon RSA 2048 M02)', 5],
  ['Cloudflare, Inc. (Cloudflare TLS Issuing ECC CA 1)', 4],
  ['Actalis S.p.A.', 1],
];
const ISSUER_POOL = ISSUERS.flatMap(([n, w]) => Array(w).fill(n));
export const LOGS = ['Google Argon 2026h2', 'Google Xenon 2026h2', 'Cloudflare Nimbus 2026', "Let's Encrypt Oak 2026h2", 'DigiCert Wyvern 2026h2'];
// Allow-listed official names renew certificates all the time; a few appear in the stream for realism.
const OFFICIAL_SAMPLES = ['www.rta.ae', 'eservices.tax.gov.ae', 'www.salik.ae', 'api.dubaipolice.gov.ae', 'www.emiratespost.ae', 'smartapps.dewa.gov.ae', 'www.moi.gov.ae', 'id.uaepass.ae', 'www.mohre.gov.ae', 'portal.tamm.abudhabi', 'www.u.ae'];
// Occasional low-score near-misses that still pass the filter (benign businesses, parked names).
const NEAR_MISS = ['dubai-fines-info.com', 'uae-tax-advisors.com', 'emirates-parcel-tracking.net', 'salik-shop.com', 'rta-training-center.com', 'nol-card-balance.net', 'dewa-bill-helper.com'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Feed {
  constructor(seed = 1234) {
    this.rng = mulberry32(seed);
    this.index = 1_000_000 + Math.floor(this.rng() * 500_000);
  }

  pick(arr) {
    return arr[Math.floor(this.rng() * arr.length)];
  }

  int(lo, hi) {
    return lo + Math.floor(this.rng() * (hi - lo + 1));
  }

  syntheticDomains() {
    const roll = this.rng();
    const tld = this.pick(TLDS);
    const w = () => this.pick(WORDS);
    let base;
    if (roll < 0.35) base = `${w()}${w()}.${tld}`;
    else if (roll < 0.6) base = `${w()}-${w()}.${tld}`;
    else if (roll < 0.72) base = `${w()}${this.int(1, 99)}.${tld}`;
    else if (roll < 0.8) base = `${this.pick(FIRST_NAMES)}${w()}.${tld}`;
    else if (roll < 0.88) base = `${w()}.${tld}`;
    else base = this.pick([`dubai-${w()}.com`, `${w()}-uae.com`, `emirates-${w()}.ae`, `abudhabi${w()}.com`, `${w()}-payments.com`, `${w()}-tax.co.uk`, `fine-${w()}.com`, `${w()}refund.net`, `gov${w()}.org`]);
    const domains = [base];
    const r2 = this.rng();
    if (r2 < 0.45) domains.unshift(`www.${base}`);
    else if (r2 < 0.6) domains.unshift(`*.${base}`);
    else if (r2 < 0.75) for (let i = 0; i < this.int(1, 4); i++) domains.push(`${this.pick(SUBS)}.${base}`);
    return [...new Set(domains)];
  }

  officialDomains() {
    return [this.pick(OFFICIAL_SAMPLES)];
  }

  nearMissDomains() {
    const d = this.pick(NEAR_MISS);
    return [`www.${d}`, d];
  }

  randomIssuer() {
    return this.pick(ISSUER_POOL);
  }

  randomLog() {
    return this.pick(LOGS);
  }

  /** Build a CertEntry (without match fields; the pipeline fills those in). */
  entry(domains, issuer, log, now = new Date()) {
    this.index += this.int(1, 7);
    const issued = new Date(now.getTime() - (2 + this.rng() * 23) * 1000);
    const shortLived = /Encrypt|ZeroSSL|Google/.test(issuer);
    return {
      id: `cert_${createHash('sha256').update(`${log}|${this.index}|${domains.join(',')}|${now.getTime()}`).digest('hex').slice(0, 10)}`,
      source: 'replay',
      log,
      index: this.index,
      seen_at: now.toISOString(),
      issued_at: issued.toISOString(),
      not_before: new Date(issued.getTime() - 3600_000).toISOString(),
      not_after: new Date(issued.getTime() + (shortLived ? 90 : 397) * 86400_000).toISOString(),
      issuer,
      domains,
      is_precert: this.rng() < 0.8,
      fingerprint: createHash('sha256').update(`${log}|${this.index}|${domains.join('|')}`).digest('hex'),
      match_score: 0,
      matched_domain: null,
      allowlisted: false,
    };
  }
}
