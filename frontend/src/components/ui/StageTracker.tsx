import { Check } from 'lucide-react';
import { STAGES, type StageStatus } from '../../lib/detections';
import { toneClasses } from '../../lib/tones';
import { Chip } from './Chip';

/** Detected → Verifying → Verified → Evidence → Awaiting approval → Blocked */
export function StageTracker({ status, compact }: { status: StageStatus; compact?: boolean }) {
  const { index, active, terminal } = status;
  const doneUntil = active ? index - 1 : index; // stages <= doneUntil are complete
  return (
    <div>
      <ol className="flex items-center" aria-label="Pipeline stage">
        {STAGES.map((label, i) => {
          const complete = i <= doneUntil && !(terminal && i > index);
          const current = i === index && !terminal;
          const future = i > index;
          const tone = complete && !terminal ? (i === 5 ? 'emerald' : 'ink') : current ? status.tone : 'line';
          const dotCls =
            tone === 'ink'
              ? 'bg-ink-2 border-ink-2'
              : tone === 'line'
                ? 'bg-transparent border-line-strong'
                : `${toneClasses[tone as keyof typeof toneClasses].dot} border-transparent`;
          return (
            <li key={label} className={`flex items-center ${i < STAGES.length - 1 ? 'flex-1' : ''}`} title={label}>
              <span
                className={`relative flex items-center justify-center rounded-full border ${compact ? 'size-3.5' : 'size-4'} ${dotCls} ${
                  current && active ? 'animate-pulse-soft' : ''
                } ${terminal && future ? 'opacity-40' : ''}`}
              >
                {complete && !current && <Check className={`${compact ? 'size-2' : 'size-2.5'} text-bg`} strokeWidth={3} />}
                {current && !active && <span className="size-1.5 rounded-full bg-bg/80" />}
              </span>
              {i < STAGES.length - 1 && <span className={`h-px flex-1 mx-1 ${i < doneUntil || (i < index && !terminal) ? 'bg-ink-3' : 'bg-line-strong'}`} />}
            </li>
          );
        })}
      </ol>
      {!compact && (
        <div className="flex items-center justify-between mt-1.5 gap-2">
          <span className="text-[11.5px] leading-snug truncate" title={`${STAGES[index]} · ${status.message}`}>
            {!terminal && <span className={`font-medium ${toneClasses[status.tone].text}`}>{STAGES[index]}</span>}
            <span className={terminal ? toneClasses[status.tone].text : 'text-ink-3'}>
              {terminal ? status.message : ` · ${status.message}`}
            </span>
          </span>
          {terminal && (
            <Chip tone={terminal.tone} size="xs">
              {terminal.label}
            </Chip>
          )}
        </div>
      )}
    </div>
  );
}
