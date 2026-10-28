import type { CaseSummary, Verdict } from '../../api/types';
import { Card, CardHeader } from '../ui/Card';
import { SignalBar } from '../ui/Risk';

function textHint(v: Verdict | null): string {
  if (!v) return '';
  const t = v.text;
  const bits: string[] = [];
  if (t.brand_mentions.length) bits.push(`brand mentions: ${t.brand_mentions.slice(0, 3).join(', ')}`);
  if (t.payment_terms.length) bits.push(`${t.payment_terms.length} payment term${t.payment_terms.length === 1 ? '' : 's'}`);
  if (t.urgency_terms.length) bits.push(`${t.urgency_terms.length} urgency cue${t.urgency_terms.length === 1 ? '' : 's'} (“${t.urgency_terms[0]}”)`);
  if (t.gov_claims.length) bits.push(`claims to be ${t.gov_claims[0]}`);
  if (t.arabic_ratio > 0) bits.push(`${Math.round(t.arabic_ratio * 100)}% Arabic`);
  return bits.join(' · ');
}

export function SignalsPanel({ summary, verdict }: { summary: CaseSummary; verdict: Verdict | null }) {
  const comps = summary.verdict.components;
  const tv = summary.verdict.top_visual;
  const logo = verdict?.logos[0];
  const dom = verdict?.domain;
  const domainHint = dom
    ? [...dom.reasons.slice(0, 2), dom.idn_homoglyph ? 'IDN homoglyph' : '', dom.free_ca ? 'free automated CA' : '', dom.risky_tld ? 'abuse-prone TLD' : '', dom.cert_age_hours != null ? `certificate ${dom.cert_age_hours < 1 ? `${Math.round(dom.cert_age_hours * 60)} min` : `${dom.cert_age_hours.toFixed(1)} h`} old` : '']
        .filter(Boolean)
        .join(' · ')
    : `look-alike score ${summary.lookalike_score}`;

  const rows = [
    { key: 'visual', label: 'Visual similarity', value: comps.visual ?? 0, hint: tv ? `Closest official page ${tv.reference_name} — cosine ${tv.similarity.toFixed(2)}${tv.ssim != null ? `, SSIM ${tv.ssim.toFixed(2)}` : ''}` : 'No reference page is visually close' },
    { key: 'logo', label: 'Logo reuse', value: comps.logo ?? 0, hint: logo ? `Logo of ${logo.reference_domain} found (match ${logo.score.toFixed(2)}, scale ×${logo.scale.toFixed(2)})` : 'No protected logo detected' },
    { key: 'text', label: 'Page text', value: comps.text ?? 0, hint: textHint(verdict) || 'No brand, payment or urgency vocabulary' },
    { key: 'form', label: 'Form fields', value: comps.form ?? 0, hint: verdict?.form.summary || summary.verdict.form_summary || 'No form captured' },
    { key: 'domain', label: 'Domain name', value: comps.domain ?? 0, hint: domainHint },
  ];

  return (
    <Card>
      <CardHeader title="Signals" titleAr="المؤشرات" subtitle="five components combined into the risk score" />
      <div className="divide-y divide-line/60">
        {rows.map((r) => (
          <SignalBar key={r.key} label={r.label} value={r.value} hint={r.hint} />
        ))}
      </div>
      {summary.verdict.explanations.length > 0 && (
        <div className="mt-3 pt-3 border-t border-line">
          <div className="label-xs mb-1.5">Why this verdict</div>
          <ul className="space-y-1">
            {summary.verdict.explanations.map((x, i) => (
              <li key={i} className="flex gap-2 text-[12px] text-ink-2 leading-snug">
                <span className="mt-[6px] size-1.5 rounded-full bg-red/70 shrink-0" />
                <span>{x}</span>
              </li>
            ))}
          </ul>
          {verdict?.recommended_action && (
            <p className="text-[12px] text-ink-3 mt-2">
              Recommended: <span className="text-ink">{verdict.recommended_action}</span>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
