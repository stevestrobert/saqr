/** Formatting helpers: numbers, relative times, durations, hashes, domains. */

const intFmt = new Intl.NumberFormat('en-US');
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtInt = (n: number | null | undefined): string => (n === null || n === undefined || Number.isNaN(n) ? '—' : intFmt.format(Math.round(n)));
export const fmtCompact = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : compactFmt.format(n);

export const fmtPct = (n: number | null | undefined, digits = 0): string =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : `${n.toFixed(digits)}%`;

/** Whole percent normally; one decimal near the ceiling so 99.7% is never shown as a misleading 100%. */
export const fmtPctSmart = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n >= 99 && n < 100 ? `${n.toFixed(1)}%` : `${Math.round(n)}%`;

export const fmtScore = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : `${Math.round(n)}`;

export const fmtSimilarity = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(2);

export const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const fmt1 = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));

/** Minutes → compact human duration ("38 s", "4.2 min", "2.1 h", "9 h", "2 d"). */
export const fmtMinutes = (m: number | null | undefined): string => {
  if (m === null || m === undefined || Number.isNaN(m)) return '—';
  if (m < 1) return `${Math.round(m * 60)} s`;
  if (m < 60) return `${m < 10 ? fmt1(m) : Math.round(m)} min`;
  const h = m / 60;
  if (h < 48) return `${h < 10 ? fmt1(h) : Math.round(h)} h`;
  return `${fmt1(h / 24)} d`;
};

/** Milliseconds → "12 s", "4 min 12 s", "2 h 05 min", "3 d 2 h". */
export const fmtDuration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
};

export const parseTime = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** "42 s ago", "3 min ago", "2 h ago", "4 d ago"; future → "in 42 s". */
export const fmtRelative = (iso: string | null | undefined, now = Date.now()): string => {
  const t = parseTime(iso);
  if (t === null) return '—';
  let diff = now - t;
  if (diff < 0 && diff > -15_000) diff = 0; // small clock skew between server and browser
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? ' ago' : '';
  const prefix = diff < 0 ? 'in ' : '';
  let body: string;
  if (abs < 1500) body = 'now';
  else if (abs < 60_000) body = `${Math.round(abs / 1000)} s`;
  else if (abs < 3_600_000) body = `${Math.round(abs / 60_000)} min`;
  else if (abs < 86_400_000) body = `${Math.round(abs / 3_600_000)} h`;
  else body = `${Math.round(abs / 86_400_000)} d`;
  if (body === 'now') return diff >= 0 ? 'just now' : 'now';
  return `${prefix}${body}${suffix}`;
};

export const fmtExact = (iso: string | null | undefined): string => {
  const t = parseTime(iso);
  if (t === null) return '—';
  const d = new Date(t);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

export const fmtClock = (iso: string | null | undefined): string => {
  const t = parseTime(iso);
  if (t === null) return '—:—:—';
  const d = new Date(t);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
};

export const fmtDate = (iso: string | null | undefined): string => {
  const t = parseTime(iso);
  if (t === null) return '—';
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
};

export const shortHash = (h: string | null | undefined, n = 12): string => (h ? `${h.slice(0, n)}…` : '—');

export const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Short issuer name: "Let's Encrypt (R12)" → "Let's Encrypt"; "DigiCert Inc (DigiCert Global ...)" → "DigiCert Inc". */
export const shortIssuer = (issuer: string): string => {
  if (!issuer) return '—';
  const i = issuer.indexOf(' (');
  return (i > 0 ? issuer.slice(0, i) : issuer).replace(/,? Inc\.?$/, '');
};

/** Short CT log label: "Google Argon 2026h2" → "Argon 2026h2". */
export const shortLog = (log: string): string => {
  if (!log) return '—';
  try {
    if (log.startsWith('http')) {
      const u = new URL(log);
      const path = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? '';
      return `${u.hostname.split('.').slice(-2, -1)[0] ?? u.hostname} ${path}`.trim();
    }
  } catch {
    /* fallthrough */
  }
  return log.replace(/^(Google|Cloudflare|Let's Encrypt|DigiCert|Sectigo)\s+/, '');
};

export const humanize = (s: string | null | undefined): string => (s ? s.replace(/_/g, ' ') : '—');

export const titleCase = (s: string): string => s.replace(/(^|[\s_-])(\w)/g, (_m, sep: string, c: string) => `${sep === '_' ? ' ' : sep}${c.toUpperCase()}`);

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** RFC 3492 punycode decoding of one label (without the "xn--" prefix). */
function punycodeDecode(input: string): string {
  const base = 36;
  const tMin = 1;
  const tMax = 26;
  const skew = 38;
  const damp = 700;
  let n = 128;
  let i = 0;
  let bias = 72;
  const output: number[] = [];
  const basic = Math.max(0, input.lastIndexOf('-'));
  for (let j = 0; j < basic; j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) throw new Error('not-basic');
    output.push(c);
  }
  const digit = (c: number) => (c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base);
  const adapt = (delta: number, numPoints: number, first: boolean) => {
    delta = first ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length; ) {
    const oldi = i;
    let w = 1;
    for (let k = base; ; k += base) {
      if (idx >= input.length) throw new Error('truncated');
      const d = digit(input.charCodeAt(idx++));
      if (d >= base) throw new Error('bad-digit');
      i += d * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (d < t) break;
      w *= base - t;
    }
    bias = adapt(i - oldi, output.length + 1, oldi === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/** Decode punycode (xn--) labels to Unicode for display. Falls back to the input label on failure. */
export function toUnicodeDomain(domain: string): string {
  if (!domain || !/xn--/i.test(domain)) return domain;
  return domain
    .split('.')
    .map((label) => {
      if (!label.toLowerCase().startsWith('xn--')) return label;
      try {
        return punycodeDecode(label.slice(4).toLowerCase());
      } catch {
        return label;
      }
    })
    .join('.');
}

export const isPunycode = (domain: string) => /(^|\.)xn--/i.test(domain);
