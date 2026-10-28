import { useLive } from '../../hooks/useLiveEvents';
import { fmtInt } from '../../lib/format';
import { Card, CardHeader } from '../ui/Card';
import { Funnel } from '../ui/Funnel';
import { ReductionGauge } from '../ui/Gauge';

export function FunnelCard() {
  const metrics = useLive((s) => s.metrics);
  const bootstrapped = useLive((s) => s.bootstrapped);
  const f = metrics?.funnel ?? {};
  const stages = [
    { key: 'certs_seen', label: 'Certs seen', value: f.certs_seen ?? metrics?.certs_seen ?? 0 },
    { key: 'filtered', label: 'Passed filter', value: f.filtered ?? f.candidates ?? metrics?.candidates ?? 0 },
    { key: 'verified', label: 'Verified', value: f.verified ?? 0 },
    { key: 'confirmed', label: 'Confirmed fake', value: f.confirmed ?? metrics?.cases_confirmed ?? 0 },
    { key: 'blocked', label: 'Blocked', value: f.blocked ?? metrics?.cases_blocked ?? 0 },
  ];
  const first = stages[0].value;
  const last = stages[stages.length - 1].value;
  return (
    <Card>
      <CardHeader
        title="Pipeline funnel"
        titleAr="المسار"
        subtitle={first > 0 && last > 0 ? `${fmtInt(first)} certificates → ${fmtInt(last)} blocked · 1 in ${fmtInt(first / last)}` : 'from the global certificate stream to blocked pages'}
      />
      <Funnel stages={stages} loading={!metrics && !bootstrapped} />
      <p className="text-[11px] text-ink-4 mt-3">
        Bars use a logarithmic scale. Approved but not yet confirmed: <span className="tnum text-ink-3">{fmtInt((f.approved ?? 0) - (f.blocked ?? 0) > 0 ? (f.approved ?? 0) - (f.blocked ?? 0) : 0)}</span>
      </p>
    </Card>
  );
}

export function TargetsCard() {
  const metrics = useLive((s) => s.metrics);
  const bootstrapped = useLive((s) => s.bootstrapped);
  const loading = !metrics && !bootstrapped;
  return (
    <Card>
      <CardHeader title="Programme targets" titleAr="الأهداف" subtitle="median per case vs the documented manual baseline" />
      <div className="grid grid-cols-2 gap-2">
        <ReductionGauge
          title="Time-to-identify"
          subtitle="certificate issued → detected"
          reductionPct={metrics?.tti_reduction_pct ?? null}
          targetPct={70}
          currentMinutes={metrics?.median_tti_minutes ?? null}
          baselineMinutes={metrics?.baseline_tti_minutes ?? 540}
          loading={loading}
        />
        <ReductionGauge
          title="Exposure window"
          subtitle="detected → first block confirmed"
          reductionPct={metrics?.exposure_reduction_pct ?? null}
          targetPct={50}
          currentMinutes={metrics?.median_exposure_minutes ?? null}
          baselineMinutes={metrics?.baseline_exposure_minutes ?? 2880}
          loading={loading}
        />
      </div>
    </Card>
  );
}
