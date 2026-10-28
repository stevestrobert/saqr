import type { ReactNode } from 'react';
import type { ActionStatus, CaseState, VerdictLabel } from '../../api/types';
import { actionLabel, actionTone, stateLabel, stateTone, toneClasses, verdictLabel, verdictTone, type Tone } from '../../lib/tones';

export interface ChipProps {
  tone?: Tone;
  children: ReactNode;
  pulse?: boolean;
  dot?: boolean;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  title?: string;
  mono?: boolean;
}

export function Chip({ tone = 'slate', children, pulse, dot, size = 'sm', className = '', title, mono }: ChipProps) {
  const t = toneClasses[tone];
  const sizeCls = size === 'xs' ? 'h-[18px] px-1.5 text-[10.5px]' : size === 'md' ? 'h-7 px-2.5 text-[12.5px]' : 'h-[22px] px-2 text-[11.5px]';
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-md border font-medium leading-none whitespace-nowrap ${sizeCls} ${t.chip} ${mono ? 'font-mono' : ''} ${className}`}
    >
      {dot && <span className={`inline-block size-1.5 rounded-full ${t.dot} ${pulse ? 'animate-pulse-soft' : ''}`} />}
      {children}
    </span>
  );
}

export function VerdictChip({ label, size, className }: { label: VerdictLabel; size?: ChipProps['size']; className?: string }) {
  return (
    <Chip tone={verdictTone[label] ?? 'slate'} size={size} className={className} dot>
      {verdictLabel[label] ?? label}
    </Chip>
  );
}

export function StateChip({ state, size, className, pulse }: { state: CaseState; size?: ChipProps['size']; className?: string; pulse?: boolean }) {
  return (
    <Chip tone={stateTone[state] ?? 'slate'} size={size} className={className} dot pulse={pulse ?? state === 'approved'}>
      {stateLabel[state] ?? state}
    </Chip>
  );
}

export function ActionChip({ status, size, className }: { status: ActionStatus; size?: ChipProps['size']; className?: string }) {
  return (
    <Chip tone={actionTone[status] ?? 'slate'} size={size} className={className} dot pulse={status === 'sent' || status === 'pending'}>
      {actionLabel[status] ?? status}
    </Chip>
  );
}

export function ScoreChip({ score, threshold = 35, allowlisted, size = 'xs' }: { score: number; threshold?: number; allowlisted?: boolean; size?: ChipProps['size'] }) {
  if (allowlisted) {
    return (
      <Chip tone="emerald" size={size} mono>
        official
      </Chip>
    );
  }
  if (score >= threshold) {
    return (
      <Chip tone="amber" size={size} mono title={`Look-alike score ${score} ≥ threshold ${threshold}`}>
        {score}
      </Chip>
    );
  }
  return (
    <span className={`inline-flex items-center justify-center font-mono tnum text-ink-4 ${size === 'xs' ? 'text-[10.5px]' : 'text-[11.5px]'}`}>
      {score > 0 ? score : '·'}
    </span>
  );
}
