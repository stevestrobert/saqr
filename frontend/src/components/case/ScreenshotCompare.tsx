import { useState } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import type { CaseSummary, ReferencePage } from '../../api/types';
import { urls } from '../../api/client';
import { fmtSimilarity, toUnicodeDomain } from '../../lib/format';
import { Card, CardHeader } from '../ui/Card';
import { Segmented } from '../ui/Segmented';
import { Thumb } from '../ui/Thumb';

function Frame({ title, domain, tone, src, view, alt }: { title: string; domain: string; tone: 'red' | 'emerald'; src: string | null; view: 'desktop' | 'mobile'; alt: string }) {
  return (
    <div className="rounded-lg border border-line overflow-hidden bg-sunken min-w-0">
      <div className="h-8 px-3 flex items-center gap-2 border-b border-line bg-surface whitespace-nowrap min-w-0">
        <span className={`size-2 rounded-full shrink-0 ${tone === 'red' ? 'bg-red' : 'bg-emerald'}`} />
        <span className={`text-[11.5px] font-medium shrink-0 ${tone === 'red' ? 'text-red' : 'text-emerald'}`}>{title}</span>
        <span className="font-mono text-[11.5px] text-ink-3 truncate ml-1 min-w-0" dir="auto" title={domain}>
          {domain || '—'}
        </span>
      </div>
      {view === 'desktop' ? (
        <Thumb src={src} alt={alt} className="w-full aspect-[16/10] border-0" placeholder={src ? 'Screenshot unavailable' : 'No reference page'} />
      ) : (
        <div className="h-[400px] flex items-center justify-center p-3 bg-[radial-gradient(rgb(255_255_255/0.03)_1px,transparent_1px)] [background-size:12px_12px]">
          <Thumb src={src} alt={alt} className="h-full aspect-[9/19] rounded-xl" placeholder={src ? 'Mobile screenshot unavailable' : 'No reference page'} />
        </div>
      )}
    </div>
  );
}

export function ScreenshotCompare({ summary, reference }: { summary: CaseSummary; reference: ReferencePage | null }) {
  const [view, setView] = useState<'desktop' | 'mobile'>('desktop');
  const tv = summary.verdict.top_visual;
  const suspectSrc = view === 'desktop' ? summary.screenshot_url : (summary.mobile_screenshot_url ?? urls.screenshot(summary.id, 'mobile'));
  const refSrc = reference?.screenshot_url ?? null;
  const sim = tv?.similarity ?? null;
  const simTone = sim === null ? 'text-ink-3' : sim >= 0.85 ? 'text-red' : sim >= 0.6 ? 'text-amber' : 'text-ink-2';
  // The backend shows the imitated entity's own page when nothing in the gallery matches visually.
  const byEntity = !!reference?.reason && reference.reason.includes('imitated');
  const refLabel = byEntity ? 'Imitated entity page' : 'Nearest official page';
  const subtitle = reference
    ? `${byEntity ? 'No official layout matches — showing the page of the imitated entity' : 'Nearest official page'}: ${reference.name} (${reference.domain})` +
      (byEntity && tv ? ` · closest by similarity: ${tv.reference_domain} ${fmtSimilarity(tv.similarity)}` : '') +
      ` · encoder ${summary.verdict.encoder || '—'}`
    : tv
      ? `Nearest official page: ${tv.reference_name} (${tv.reference_domain}) · encoder ${summary.verdict.encoder || '—'}`
      : 'No visually similar official page in the gallery';

  return (
    <Card>
      <CardHeader
        title="Visual comparison"
        titleAr="المقارنة البصرية"
        subtitle={subtitle}
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'desktop', label: 'Desktop' },
              { value: 'mobile', label: 'Mobile' },
            ]}
          />
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)] items-center gap-2">
        <Frame title="Suspect page" domain={toUnicodeDomain(summary.domain)} tone="red" src={suspectSrc} view={view} alt={`Screenshot of ${summary.domain}`} />
        <div className="flex flex-col items-center justify-center text-center gap-1.5">
          <div className={`size-[68px] rounded-full border-2 ${sim !== null && sim >= 0.85 ? 'border-red/60 bg-red/10' : sim !== null && sim >= 0.6 ? 'border-amber/60 bg-amber/10' : 'border-line bg-sunken'} flex flex-col items-center justify-center`}>
            <span className={`text-[18px] font-semibold leading-none ${simTone}`}>{fmtSimilarity(sim)}</span>
            <span className="text-[9px] uppercase tracking-wider text-ink-3 mt-1">visual</span>
          </div>
          <div className="text-[11px] text-ink-3 leading-tight">
            SSIM <span className="tnum text-ink-2">{fmtSimilarity(tv?.ssim ?? null)}</span>
          </div>
          {view === 'desktop' ? <Monitor className="size-3.5 text-ink-4" /> : <Smartphone className="size-3.5 text-ink-4" />}
        </div>
        <Frame title={refLabel} domain={reference?.domain ?? tv?.reference_domain ?? ''} tone="emerald" src={refSrc} view={view} alt={`Reference screenshot of ${reference?.domain ?? ''}`} />
      </div>
    </Card>
  );
}
