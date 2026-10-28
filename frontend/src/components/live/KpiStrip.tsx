import { useEffect, useRef, useState } from 'react';
import { useLive } from '../../hooks/useLiveEvents';
import { fmtInt, fmtMinutes, fmtPctSmart } from '../../lib/format';
import { KpiTile } from '../ui/KpiTile';

/** Samples the live cert counter every few seconds into a short rate history for the sparkline. */
function useRateHistory(count: number, points = 16, intervalMs = 2500): number[] {
  const [hist, setHist] = useState<number[]>([]);
  const countRef = useRef(count);
  countRef.current = count;
  const last = useRef<{ c: number; t: number } | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      const c = countRef.current;
      if (last.current) {
        const dt = (now - last.current.t) / 1000;
        setHist((h) => [...h, dt > 0 ? (c - last.current!.c) / dt : 0].slice(-points));
      }
      last.current = { c, t: now };
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [points, intervalMs]);
  return hist;
}

export function KpiStrip() {
  const metrics = useLive((s) => s.metrics);
  const status = useLive((s) => s.status);
  const certCount = useLive((s) => s.certCount);
  const bootstrapped = useLive((s) => s.bootstrapped);
  const spark = useRateHistory(certCount);
  const loading = !metrics && !bootstrapped;

  const rate = status?.sources?.rate_per_min ?? metrics?.certs_per_minute ?? 0;
  const ttiMet = (metrics?.tti_reduction_pct ?? -1) >= 70;
  const expMet = (metrics?.exposure_reduction_pct ?? -1) >= 50;
  const fp = metrics?.false_positives ?? 0;

  return (
    <div className="grid grid-cols-7 gap-3">
      <KpiTile label="Certs scanned" value={fmtInt(metrics?.certs_seen)} sub={`${fmtInt(rate)}/min · ${fmtInt(certCount)} live`} loading={loading} spark={spark.length > 1 ? spark : undefined} tone="sky" />
      <KpiTile label="Candidates" value={fmtInt(metrics?.candidates)} sub="passed the filter" loading={loading} />
      <KpiTile label="Open cases" value={fmtInt(metrics?.cases_open)} sub="awaiting sign-off" loading={loading} tone={(metrics?.cases_open ?? 0) > 0 ? 'amber' : undefined} />
      <KpiTile label="Confirmed fakes" value={fmtInt(metrics?.cases_confirmed)} sub={`${fmtInt(fp)} false positive${fp === 1 ? '' : 's'}`} loading={loading} tone="red" />
      <KpiTile label="Blocks sent" value={fmtInt(metrics?.cases_blocked)} sub={`${fmtInt(metrics?.funnel?.approved ?? 0)} approved`} loading={loading} tone="emerald" />
      <KpiTile
        label="Time-to-identify"
        value={fmtMinutes(metrics?.median_tti_minutes)}
        sub={metrics?.tti_reduction_pct != null ? `−${fmtPctSmart(metrics.tti_reduction_pct)} vs ${fmtMinutes(metrics.baseline_tti_minutes)} baseline` : 'issued → detected'}
        loading={loading}
        tone={ttiMet ? 'emerald' : undefined}
      />
      <KpiTile
        label="Exposure window"
        value={fmtMinutes(metrics?.median_exposure_minutes)}
        sub={metrics?.exposure_reduction_pct != null ? `−${fmtPctSmart(metrics.exposure_reduction_pct)} vs ${fmtMinutes(metrics.baseline_exposure_minutes)} baseline` : 'detected → first block'}
        loading={loading}
        tone={expMet ? 'emerald' : undefined}
      />
    </div>
  );
}
