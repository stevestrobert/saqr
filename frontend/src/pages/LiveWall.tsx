import { KpiStrip } from '../components/live/KpiStrip';
import { CertTicker } from '../components/live/CertTicker';
import { Detections } from '../components/live/Detections';
import { FunnelCard, TargetsCard } from '../components/live/Charts';

export function LiveWall() {
  return (
    <div className="space-y-4">
      <KpiStrip />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(340px,404px)] gap-4">
        <CertTicker />
        <Detections />
      </div>
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4">
        <FunnelCard />
        <TargetsCard />
      </div>
    </div>
  );
}
