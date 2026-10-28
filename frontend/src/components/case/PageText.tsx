import { useState } from 'react';
import { FileText } from 'lucide-react';
import type { Capture, TextSignals } from '../../api/types';
import { fmtInt } from '../../lib/format';
import { Card, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { SkeletonCard } from '../ui/Skeleton';

export function PageText({ excerpt, capture, text, loading }: { excerpt: string; capture: Capture | null; text: TextSignals | null; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const body = excerpt || capture?.text || '';
  const shown = expanded ? body : body.slice(0, 520);
  const terms = text ? [...text.gov_claims.map((t) => ({ t, tone: 'text-sky' })), ...text.payment_terms.map((t) => ({ t, tone: 'text-amber' })), ...text.urgency_terms.map((t) => ({ t, tone: 'text-red' }))] : [];

  return (
    <Card>
      <CardHeader
        title="Page text"
        titleAr="نص الصفحة"
        subtitle={capture ? `${fmtInt(capture.text_length)} characters · lang ${capture.lang || '?'} · HTTP ${capture.status ?? '—'} · ${capture.resource_count} resources` : 'extracted from the isolated capture'}
      />
      {loading ? (
        <SkeletonCard lines={5} />
      ) : !body ? (
        <EmptyState icon={<FileText className="size-4" />} title="No text captured" hint={capture?.error || 'The page returned no readable text.'} compact />
      ) : (
        <>
          <p className="text-[12px] text-ink-2 leading-relaxed whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto rounded-md bg-sunken/60 border border-line p-2.5" dir="auto">
            {shown}
            {!expanded && body.length > 520 && '…'}
          </p>
          {body.length > 520 && (
            <button onClick={() => setExpanded((v) => !v)} className="text-[11.5px] text-gold hover:text-gold-2 mt-1.5">
              {expanded ? 'Show less' : `Show all ${fmtInt(body.length)} characters`}
            </button>
          )}
          {terms.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1">
              {terms.slice(0, 14).map(({ t, tone }, i) => (
                <span key={`${t}${i}`} className={`text-[11px] bg-sunken border border-line rounded px-1.5 py-px ${tone}`} dir="auto">
                  {t}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
