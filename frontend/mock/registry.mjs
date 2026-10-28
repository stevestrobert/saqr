// Protected registry (mirror of saqr/data/protected_domains.yaml) and a compact port of the look-alike matcher.
import { domainToUnicode } from 'node:url';

export const OFFICIAL_SUFFIXES = ['gov.ae', 'mil.ae', 'ac.ae', 'sch.ae'];

export const ENTITIES = [
  { id: 'rta', name: 'Roads and Transport Authority (Dubai)', name_ar: 'هيئة الطرق والمواصلات', sector: 'transport', domains: ['rta.ae', 'nol.ae'], brands: ['rta', 'nol', 'rtadubai'], ambiguous: ['rta', 'nol'], services: ['traffic fines', 'parking fines', 'nol card top-up', 'vehicle registration renewal', 'driving licence renewal'] },
  { id: 'salik', name: 'Salik (Dubai toll)', name_ar: 'سالك', sector: 'transport', domains: ['salik.ae'], brands: ['salik'], ambiguous: [], services: ['toll recharge', 'toll statement', 'salik fines'] },
  { id: 'dubaipolice', name: 'Dubai Police', name_ar: 'شرطة دبي', sector: 'police', domains: ['dubaipolice.gov.ae'], brands: ['dubaipolice', 'dubai-police'], ambiguous: [], services: ['traffic fines', 'police clearance fees'] },
  { id: 'adpolice', name: 'Abu Dhabi Police', name_ar: 'شرطة أبوظبي', sector: 'police', domains: ['adpolice.gov.ae'], brands: ['adpolice', 'abudhabipolice'], ambiguous: [], services: ['traffic fines'] },
  { id: 'shjpolice', name: 'Sharjah Police', name_ar: 'شرطة الشارقة', sector: 'police', domains: ['shjpolice.gov.ae'], brands: ['shjpolice', 'sharjahpolice'], ambiguous: [], services: ['traffic fines'] },
  { id: 'moi', name: 'Ministry of Interior', name_ar: 'وزارة الداخلية', sector: 'federal', domains: ['moi.gov.ae'], brands: ['moi', 'moiuae'], ambiguous: ['moi'], services: ['traffic fines', 'vehicle registration', 'driving licence'] },
  { id: 'fta', name: 'Federal Tax Authority', name_ar: 'الهيئة الاتحادية للضرائب', sector: 'finance', domains: ['tax.gov.ae', 'emaratax.gov.ae'], brands: ['fta', 'emaratax', 'taxgov'], ambiguous: ['fta', 'tax'], services: ['VAT refund', 'tax payment', 'excise tax', 'tourist refund'] },
  { id: 'mof', name: 'Ministry of Finance', name_ar: 'وزارة المالية', sector: 'finance', domains: ['mof.gov.ae'], brands: ['mof', 'edirham', 'e-dirham'], ambiguous: ['mof'], services: ['e-Dirham payments', 'federal fees'] },
  { id: 'emiratespost', name: 'Emirates Post', name_ar: 'بريد الإمارات', sector: 'postal', domains: ['emiratespost.ae', 'epg.gov.ae'], brands: ['emiratespost', 'emirates-post', 'epost'], ambiguous: [], services: ['customs duty', 'delivery fees', 'redelivery fees', 'PO box renewal'] },
  { id: 'dewa', name: 'Dubai Electricity and Water Authority', name_ar: 'هيئة كهرباء ومياه دبي', sector: 'utilities', domains: ['dewa.gov.ae'], brands: ['dewa'], ambiguous: [], services: ['utility bill payment', 'deposit refund'] },
  { id: 'addc', name: 'Abu Dhabi Distribution Company', name_ar: 'شركة أبوظبي للتوزيع', sector: 'utilities', domains: ['addc.ae'], brands: ['addc'], ambiguous: [], services: ['utility bill payment'] },
  { id: 'sewa', name: 'Sharjah Electricity, Water and Gas Authority', name_ar: 'هيئة كهرباء ومياه وغاز الشارقة', sector: 'utilities', domains: ['sewa.gov.ae'], brands: ['sewa'], ambiguous: [], services: ['utility bill payment'] },
  { id: 'etihadwe', name: 'Etihad Water and Electricity', name_ar: 'الاتحاد للماء والكهرباء', sector: 'utilities', domains: ['etihadwe.ae'], brands: ['etihadwe'], ambiguous: [], services: ['utility bill payment'] },
  { id: 'icp', name: 'Federal Authority for Identity, Citizenship, Customs and Port Security', name_ar: 'الهيئة الاتحادية للهوية والجنسية والجمارك وأمن المنافذ', sector: 'federal', domains: ['icp.gov.ae', 'ica.gov.ae', 'uaeicp.ae'], brands: ['icp', 'ica', 'emiratesid', 'uaeicp'], ambiguous: ['icp', 'ica'], services: ['Emirates ID fees', 'visa fees', 'residency renewal', 'customs'] },
  { id: 'uaepass', name: 'UAE PASS', name_ar: 'الهوية الرقمية', sector: 'identity', domains: ['uaepass.ae'], brands: ['uaepass', 'uae-pass'], ambiguous: [], services: ['digital identity login'] },
  { id: 'mohre', name: 'Ministry of Human Resources and Emiratisation', name_ar: 'وزارة الموارد البشرية والتوطين', sector: 'federal', domains: ['mohre.gov.ae'], brands: ['mohre'], ambiguous: [], services: ['work permit fees', 'labour fines'] },
  { id: 'gdrfa', name: 'General Directorate of Residency and Foreigners Affairs (Dubai)', name_ar: 'الإدارة العامة للإقامة وشؤون الأجانب', sector: 'immigration', domains: ['gdrfad.gov.ae', 'amer.ae'], brands: ['gdrfa', 'gdrfad', 'amer'], ambiguous: ['amer'], services: ['visa fees', 'overstay fines'] },
  { id: 'dm', name: 'Dubai Municipality', name_ar: 'بلدية دبي', sector: 'municipal', domains: ['dm.gov.ae'], brands: ['dubaimunicipality'], ambiguous: [], services: ['municipal fees', 'fines'] },
  { id: 'dubaicourts', name: 'Dubai Courts', name_ar: 'محاكم دبي', sector: 'justice', domains: ['dc.gov.ae'], brands: ['dubaicourts'], ambiguous: [], services: ['court fees', 'fines'] },
  { id: 'adjd', name: 'Abu Dhabi Judicial Department', name_ar: 'دائرة القضاء أبوظبي', sector: 'justice', domains: ['adjd.gov.ae'], brands: ['adjd'], ambiguous: [], services: ['court fees', 'fines'] },
  { id: 'moj', name: 'Ministry of Justice', name_ar: 'وزارة العدل', sector: 'justice', domains: ['moj.gov.ae'], brands: ['moj'], ambiguous: ['moj'], services: ['court fees'] },
  { id: 'tamm', name: 'TAMM (Abu Dhabi Government Services)', name_ar: 'تم', sector: 'portal', domains: ['tamm.abudhabi'], brands: ['tamm'], ambiguous: [], services: ['Abu Dhabi government fees', 'fines'] },
  { id: 'itc', name: 'Abu Dhabi Mobility (Integrated Transport Centre)', name_ar: 'مركز النقل المتكامل', sector: 'transport', domains: ['itc.gov.ae', 'darb.ae'], brands: ['darb', 'mawaqif', 'itcabudhabi'], ambiguous: [], services: ['DARB toll', 'Mawaqif parking fines'] },
  { id: 'mawaqif', name: 'Mawaqif (Abu Dhabi parking)', name_ar: 'مواقف', sector: 'transport', domains: ['mawaqif.ae'], brands: ['mawaqif'], ambiguous: [], services: ['parking payment', 'parking fines'] },
  { id: 'dubaicustoms', name: 'Dubai Customs', name_ar: 'جمارك دبي', sector: 'customs', domains: ['dubaicustoms.gov.ae'], brands: ['dubaicustoms'], ambiguous: [], services: ['customs duty'] },
  { id: 'dld', name: 'Dubai Land Department', name_ar: 'دائرة الأراضي والأملاك', sector: 'property', domains: ['dubailand.gov.ae'], brands: ['dubailand'], ambiguous: [], services: ['registration fees'] },
  { id: 'dha', name: 'Dubai Health Authority', name_ar: 'هيئة الصحة بدبي', sector: 'health', domains: ['dha.gov.ae'], brands: ['dha'], ambiguous: ['dha'], services: ['medical fitness fees', 'health card'] },
  { id: 'mohap', name: 'Ministry of Health and Prevention', name_ar: 'وزارة الصحة ووقاية المجتمع', sector: 'health', domains: ['mohap.gov.ae'], brands: ['mohap'], ambiguous: [], services: ['licence fees'] },
  { id: 'gpssa', name: 'General Pension and Social Security Authority', name_ar: 'الهيئة العامة للمعاشات والتأمينات الاجتماعية', sector: 'pension', domains: ['gpssa.gov.ae'], brands: ['gpssa'], ambiguous: [], services: ['pension payments'] },
  { id: 'cbuae', name: 'Central Bank of the UAE', name_ar: 'مصرف الإمارات العربية المتحدة المركزي', sector: 'finance', domains: ['centralbank.ae'], brands: ['cbuae', 'centralbank'], ambiguous: [], services: ['consumer protection', 'fraud reporting'] },
  { id: 'tdra', name: 'Telecommunications and Digital Government Regulatory Authority', name_ar: 'هيئة تنظيم الاتصالات والحكومة الرقمية', sector: 'federal', domains: ['tdra.gov.ae'], brands: ['tdra'], ambiguous: [], services: ['government portal'] },
  { id: 'uae', name: 'UAE Government portal', name_ar: 'البوابة الرسمية لحكومة الإمارات', sector: 'portal', domains: ['u.ae', 'government.ae'], brands: ['uaegov', 'govuae'], ambiguous: [], services: ['federal services'] },
  { id: 'dubaigov', name: 'Dubai Government portal (Digital Dubai)', name_ar: 'حكومة دبي', sector: 'portal', domains: ['dubai.ae', 'digitaldubai.ae', 'dubainow.ae'], brands: ['dubainow', 'digitaldubai', 'dubaigov', 'smartdubai'], ambiguous: [], services: ['Dubai government payments'] },
  { id: 'abudhabigov', name: 'Abu Dhabi Government portal', name_ar: 'حكومة أبوظبي', sector: 'portal', domains: ['abudhabi.ae'], brands: ['abudhabigov'], ambiguous: [], services: ['Abu Dhabi government payments'] },
];

export const GOV_CUES = ['gov', 'govt', 'government', 'uae', 'emirates', 'emirate', 'dubai', 'abudhabi', 'sharjah', 'ajman', 'rak', 'fujairah', 'federal', 'ministry', 'authority', 'official', 'portal', 'eservices', 'eservice', 'smart', 'national', 'ae'];
export const KW_STRONG = ['fine', 'fines', 'refund', 'refunds', 'violation', 'violations', 'penalty', 'penalties', 'toll', 'tolls', 'customs', 'redelivery', 'overdue', 'unpaid', 'mukhalafat', 'mukhalafa', 'gharama', 'gharamat', 'istirdad'];
export const KW_NORMAL = ['pay', 'payment', 'payments', 'fee', 'fees', 'tax', 'taxes', 'vat', 'traffic', 'renew', 'renewal', 'bill', 'bills', 'invoice', 'duty', 'charge', 'charges', 'balance', 'recharge', 'topup', 'top-up', 'wallet', 'settle', 'settlement', 'due', 'mulkiya', 'license', 'licence', 'permit', 'visa', 'residency', 'grant', 'benefit', 'pension', 'salary', 'zakat', 'dirham', 'aed', 'secure', 'verify', 'verification', 'claim', 'delivery', 'parcel', 'shipment', 'suspended', 'blocked', 'outstanding', 'account', 'login', 'signin', 'update', 'service', 'services', 'rusoom', 'rasoom', 'dareeba', 'tajdeed', 'dafa', 'daf3'];
export const RISKY_TLDS = new Set(['top', 'xyz', 'shop', 'online', 'site', 'club', 'icu', 'live', 'click', 'link', 'buzz', 'work', 'rest', 'cfd', 'sbs', 'cam', 'monster', 'quest', 'cyou', 'tk', 'ml', 'ga', 'cf', 'gq', 'info', 'biz', 'vip', 'pro', 'store', 'fun', 'space', 'website', 'tech', 'pw', 'cc', 'su', 'ru', 'lol', 'bond', 'best', 'today', 'world', 'zone', 'support', 'help', 'center', 'services']);
export const FREE_CAS = ["Let's Encrypt", 'ZeroSSL', 'Google Trust Services', 'Buypass', 'SSL.com', 'Actalis', 'cPanel', 'GoGetSSL', 'TrustAsia', 'Sectigo (free)'];

const CONFUSABLES = {
  а: 'a', ӓ: 'a', ӑ: 'a', Ь: 'b', Ъ: 'b', с: 'c', ҁ: 'c', ԁ: 'd', е: 'e', ё: 'e', є: 'e', һ: 'h', н: 'h', і: 'i', ї: 'i', ӏ: 'l', ј: 'j', к: 'k', м: 'm', п: 'n', о: 'o', ӧ: 'o', ө: 'o', р: 'p', ԛ: 'q', г: 'r', ѕ: 's', т: 't', ц: 'u', ѵ: 'v', ԝ: 'w', ш: 'w', х: 'x', у: 'y', ў: 'y', з: 'z',
  α: 'a', β: 'b', ϲ: 'c', ε: 'e', η: 'n', ι: 'i', ί: 'i', κ: 'k', ο: 'o', σ: 'o', ρ: 'p', τ: 't', υ: 'u', ν: 'v', ω: 'w', χ: 'x', γ: 'y', ζ: 'z',
  ɑ: 'a', ƈ: 'c', ɖ: 'd', ɛ: 'e', ɡ: 'g', ı: 'i', ɩ: 'i', ɭ: 'l', ŋ: 'n', ơ: 'o', ʂ: 's', ƫ: 't', ʋ: 'u', ƴ: 'y',
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '@': 'a', '5': 's', $: 's', '7': 't', '8': 'b', '9': 'g', '!': 'i', օ: 'o', ո: 'n', ս: 'u', ց: 'g', հ: 'h', ժ: 'd',
};

const MULTI_SUFFIXES = new Set(['co.uk', 'com.au', 'co.in', 'com.sa', 'com.eg', 'co.za', 'org.uk', 'gov.ae', 'ac.ae', 'mil.ae', 'sch.ae', 'com.tr', 'co.jp', 'com.br']);

export function toUnicode(domain) {
  if (!domain.includes('xn--')) return domain;
  try {
    const u = domainToUnicode(domain);
    return u || domain;
  } catch {
    return domain;
  }
}

export function skeleton(text) {
  let out = '';
  for (const ch of text.toLowerCase().normalize('NFKD')) {
    if (/\p{M}/u.test(ch)) continue;
    out += CONFUSABLES[ch] ?? ch;
  }
  return out;
}

export const hasNonAscii = (s) => /[^\x00-\x7f]/.test(s);

export function splitDomain(domain) {
  let d = domain.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  const bits = d.split('.');
  if (bits.length < 2) return { subdomain: '', label: d, suffix: '', registrable: d };
  let suffixLen = 1;
  if (bits.length >= 3 && MULTI_SUFFIXES.has(bits.slice(-2).join('.'))) suffixLen = 2;
  const suffix = bits.slice(-suffixLen).join('.');
  const label = bits[bits.length - suffixLen - 1] ?? '';
  const subdomain = bits.slice(0, bits.length - suffixLen - 1).join('.');
  return { subdomain, label, suffix, registrable: `${label}.${suffix}` };
}

const labelsOf = (e) =>
  e.domains.map((d) => {
    const parts = d.split('.');
    if (parts.length >= 3 && ['gov', 'mil', 'ac', 'sch', 'co', 'com', 'net', 'org'].includes(parts[parts.length - 2])) return parts[parts.length - 3];
    return parts.length === 1 ? parts[0] : parts[parts.length - 2];
  });

const BRANDS = new Set();
const LABELS = new Set();
for (const e of ENTITIES) {
  for (const b of e.brands) {
    BRANDS.add(b);
    BRANDS.add(b.replace(/-/g, ''));
  }
  for (const l of labelsOf(e)) {
    BRANDS.add(l);
    if (l.length >= 2) LABELS.add(l);
  }
}
BRANDS.delete('u');
const STRONG = new Set(KW_STRONG);
const NORMAL = new Set(KW_NORMAL);
const CUES = new Set(GOV_CUES);
const VOCAB = new Set([...BRANDS, ...CUES, ...STRONG, ...NORMAL]);

export const isAmbiguous = (t) => ENTITIES.some((e) => e.ambiguous.includes(t)) || t.length <= 3;
const DISTINCTIVE = [...BRANDS].filter((t) => !isAmbiguous(t) && t.length >= 4);
export const PROTECTED_DOMAINS = ENTITIES.flatMap((e) => e.domains).sort((a, b) => b.length - a.length);

export const entityForDomain = (d) => ENTITIES.find((e) => e.domains.includes(d)) ?? null;
export const entityForBrand = (t) => ENTITIES.find((e) => e.brands.includes(t) || labelsOf(e).includes(t)) ?? null;

export function isAllowlisted(ascii) {
  let d = ascii.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  for (const s of OFFICIAL_SUFFIXES) {
    if (d === s || d.endsWith(`.${s}`)) {
      const rest = d === s ? '' : d.slice(0, -s.length - 1);
      const reg = rest ? `${rest.split('.').pop()}.${s}` : d;
      return entityForDomain(reg) ?? true;
    }
  }
  for (const e of ENTITIES) for (const od of e.domains) if (d === od || d.endsWith(`.${od}`)) return e;
  return false;
}

export const isFreeCA = (issuer) => FREE_CAS.some((ca) => issuer.toLowerCase().includes(ca.toLowerCase().split(' (')[0]));

function damerau(a, b, cutoff) {
  if (Math.abs(a.length - b.length) > cutoff) return cutoff + 1;
  const d = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function nearBrand(token) {
  let best = null;
  for (const b of DISTINCTIVE) {
    if (Math.abs(b.length - token.length) > 2) continue;
    const cutoff = b.length >= 8 ? 2 : 1;
    const dist = damerau(token, b, cutoff);
    if (dist <= cutoff && (!best || dist < best[1])) best = [b, dist];
  }
  return best;
}

const coarseTokens = (name) => name.split(/[-_.]+|(?<=\D)(?=\d)|(?<=\d)(?=\D)/).filter(Boolean);

function segment(chunk, maxUnknownRatio = 0.34) {
  const n = chunk.length;
  if (!n) return [];
  if (VOCAB.has(chunk)) return [chunk];
  const INF = Infinity;
  const best = new Array(n + 1).fill(null).map(() => [INF, 0, []]);
  best[0] = [0, 0, []];
  for (let i = 1; i <= n; i++) {
    const cands = [];
    for (let j = Math.max(0, i - 24); j < i; j++) {
      if (best[j][0] === INF) continue;
      const piece = chunk.slice(j, i);
      if (piece.length >= 2 && VOCAB.has(piece)) cands.push([best[j][0], best[j][1] + 1, [...best[j][2], piece]]);
    }
    if (best[i - 1][0] !== INF) {
      const prev = best[i - 1];
      const seg = [...prev[2]];
      if (seg.length && seg[seg.length - 1].startsWith('?')) seg[seg.length - 1] += chunk[i - 1];
      else seg.push(`?${chunk[i - 1]}`);
      cands.push([prev[0] + 1, prev[1], seg]);
    }
    cands.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    best[i] = cands[0];
  }
  const [unknown, , seg] = best[n];
  if (unknown / n > maxUnknownRatio) return null;
  return seg.filter((s) => !s.startsWith('?'));
}

const W = { BRAND: 45, BRAND_AMBIG: 25, COMBO: 20, HOMOGLYPH: 50, TLD_SWAP: 50, EMBEDDED: 45, EDIT: 40, KW_STRONG: 20, KW_NORMAL: 15, KW_CAP: 35, CUE: 10, CUE_CAP: 20, RISKY_TLD: 5 };

/** Port of LookalikeMatcher.match — deterministic and explainable. */
export function matchDomain(raw, threshold = 35) {
  let ascii = raw.toLowerCase().trim().replace(/\.$/, '');
  if (ascii.startsWith('*.')) ascii = ascii.slice(2);
  const unicode = toUnicode(ascii);
  const skel = skeleton(unicode);
  const result = { domain: ascii, unicode_domain: unicode, skeleton: skel, score: 0, is_candidate: false, allowlisted: false, protected_entity: null, protected_domain: null, reasons: [], tokens: [] };

  const allow = isAllowlisted(ascii);
  if (allow) {
    result.allowlisted = true;
    if (allow !== true) {
      result.protected_entity = allow.name;
      result.protected_domain = allow.domains[0];
    }
    return result;
  }
  const attribute = (pd) => {
    if (result.protected_domain) return;
    const e = entityForDomain(pd);
    result.protected_domain = pd;
    result.protected_entity = e ? e.name : null;
  };
  const attributeBrand = (b) => {
    if (result.protected_domain) return;
    const e = entityForBrand(b);
    if (e) {
      result.protected_entity = e.name;
      result.protected_domain = e.domains[0];
    }
  };

  const reasons = [];
  const parts = splitDomain(skel);
  const homoglyph = hasNonAscii(unicode) && skel !== unicode;

  for (const pd of PROTECTED_DOMAINS) {
    if (parts.registrable === pd && homoglyph) {
      reasons.push({ kind: 'homoglyph', weight: W.HOMOGLYPH + W.TLD_SWAP, detail: `IDN homograph of ${pd}: '${unicode}' renders like the official domain` });
      attribute(pd);
      break;
    }
    const flat = pd.replace(/\./g, '');
    const flatOk = flat.length >= 5;
    if (
      (`.${skel}.`.includes(`.${pd}.`) && skel !== pd) ||
      skel.includes(`${pd}.`) ||
      skel.startsWith(`${pd}.`) ||
      parts.label.includes(pd.replace(/\./g, '-')) ||
      (flatOk && (skel.includes(`www-${flat}`) || parts.label === flat || parts.label.startsWith(`${flat}-`) || parts.label.endsWith(`-${flat}`)))
    ) {
      reasons.push({ kind: 'embedded_domain', weight: W.EMBEDDED, detail: `official domain ${pd} embedded in the name` });
      attribute(pd);
      break;
    }
  }

  let tokens = [];
  const base = parts.subdomain ? `${parts.subdomain}.${parts.label}` : parts.label;
  for (const chunk of coarseTokens(base)) {
    if (VOCAB.has(chunk)) {
      tokens.push(chunk);
      continue;
    }
    const seg = segment(chunk);
    if (seg) tokens.push(...seg);
    else tokens.push(chunk);
  }
  const joined = [];
  const consumed = new Set();
  for (let i = 0; i < tokens.length - 1; i++) {
    const ab = tokens[i] + tokens[i + 1];
    if (BRANDS.has(ab) && !tokens.includes(ab)) {
      joined.push(ab);
      consumed.add(tokens[i]);
      consumed.add(tokens[i + 1]);
    }
  }
  tokens = [...joined, ...tokens];
  result.tokens = tokens;

  const brandHits = [];
  for (const t of tokens) {
    if (consumed.has(t) && !BRANDS.has(t)) continue;
    if (BRANDS.has(t) && t.length >= 3 && !CUES.has(t)) {
      const ent = entityForBrand(t);
      const amb = isAmbiguous(t);
      reasons.push({ kind: 'brand_token', weight: amb ? W.BRAND_AMBIG : W.BRAND, detail: `brand token '${t}'${ent ? ` (${ent.name})` : ''}${amb ? ' — short/ambiguous' : ''}` });
      brandHits.push(t);
      if (ent && !result.protected_entity) {
        result.protected_entity = ent.name;
        result.protected_domain = ent.domains[0];
      }
    } else if (t.length >= 5 && !VOCAB.has(t)) {
      const near = nearBrand(t);
      if (near) {
        reasons.push({ kind: near[1] === 1 ? 'typo' : 'edit_distance', weight: near[1] === 1 ? W.EDIT : W.EDIT, detail: near[1] === 1 ? `'${t}' is a typo-squat of '${near[0]}'` : `'${t}' is within edit distance ${near[1]} of brand '${near[0]}'` });
        brandHits.push(near[0]);
        attributeBrand(near[0]);
      }
    }
  }

  if (LABELS.has(parts.label) && !reasons.some((r) => r.kind === 'embedded_domain' || r.kind === 'homoglyph')) {
    const ent = entityForBrand(parts.label);
    if (ent) {
      const amb = isAmbiguous(parts.label);
      reasons.push({ kind: 'tld_swap', weight: amb ? 5 : W.TLD_SWAP, detail: `'${parts.registrable}' reuses the official label '${parts.label}' of ${ent.domains[0]} under .${parts.suffix}` });
      attribute(ent.domains[0]);
      brandHits.push(parts.label);
    }
  }
  if (homoglyph && brandHits.length && !reasons.some((r) => r.kind === 'homoglyph')) {
    reasons.push({ kind: 'homoglyph', weight: W.HOMOGLYPH, detail: `look-alike Unicode letters: '${unicode}' is spelled with non-Latin characters` });
  }

  let kw = 0;
  for (const t of new Set(tokens)) {
    if (brandHits.includes(t)) continue; // 'tax' is both an (ambiguous) brand label and a keyword: count it once
    if (STRONG.has(t)) {
      kw += W.KW_STRONG;
      reasons.push({ kind: 'keyword', weight: W.KW_STRONG, detail: `lure keyword '${t}'` });
    } else if (NORMAL.has(t)) {
      kw += W.KW_NORMAL;
      reasons.push({ kind: 'keyword', weight: W.KW_NORMAL, detail: `financial keyword '${t}'` });
    }
  }
  kw = Math.min(kw, W.KW_CAP);
  let cue = 0;
  for (const t of new Set(tokens)) {
    if (CUES.has(t)) {
      cue += W.CUE;
      reasons.push({ kind: 'gov_cue', weight: W.CUE, detail: `government cue '${t}'` });
    }
  }
  cue = Math.min(cue, W.CUE_CAP);
  if (brandHits.length && (kw || cue)) reasons.push({ kind: 'combo', weight: W.COMBO, detail: 'brand combined with payment vocabulary / government cue' });
  const tld = parts.suffix.split('.').pop() ?? '';
  if (RISKY_TLDS.has(tld) && reasons.length) reasons.push({ kind: 'risky_tld', weight: W.RISKY_TLD, detail: `abuse-prone TLD .${tld}` });

  let score = 0;
  for (const r of reasons) if (r.kind !== 'keyword' && r.kind !== 'gov_cue') score += r.weight;
  score += kw + cue;
  result.score = Math.max(0, Math.min(100, score));
  result.reasons = reasons.sort((a, b) => b.weight - a.weight);
  result.is_candidate = result.score >= threshold;
  return result;
}

/** Strongest non-allow-listed match across a certificate's SAN list. */
export function bestMatch(domains, threshold) {
  let best = null;
  for (const d of domains) {
    const m = matchDomain(d, threshold);
    if (m.allowlisted) {
      if (!best) best = m;
      continue;
    }
    if (!best || best.allowlisted || m.score > best.score || (m.score === best.score && best.domain.startsWith('www.') && !m.domain.startsWith('www.'))) best = m;
  }
  return best;
}

export const protectedRegistryResponse = () => ({
  official_suffixes: OFFICIAL_SUFFIXES,
  entities: ENTITIES.map(({ id, name, name_ar, sector, domains, brands, services }) => ({ id, name, name_ar, sector, domains, brands, services })),
  keywords: { strong: KW_STRONG, normal: KW_NORMAL },
  government_cues: GOV_CUES,
});
