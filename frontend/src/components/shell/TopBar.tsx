import type { ReactNode } from 'react';
import { Cpu, Plug, Presentation, Radio, Wifi, WifiOff } from 'lucide-react';
import { useLive } from '../../hooks/useLiveEvents';
import { fmtInt } from '../../lib/format';

function encoderName(name?: string, model?: string) {
  if (!name) return '—';
  const n = name.toLowerCase();
  if (n.includes('dino')) return model?.toLowerCase().includes('dinov3') || n.includes('v3') ? 'DINOv3' : model?.toLowerCase().includes('dinov2') ? 'DINOv2' : 'DINO';
  if (n.includes('percept')) return 'perceptual';
  return name;
}

export function TopBar({ onPresenter, presenterOpen }: { onPresenter: () => void; presenterOpen: boolean }) {
  const connection = useLive((s) => s.connection);
  const attempt = useLive((s) => s.reconnectAttempt);
  const status = useLive((s) => s.status);
  const metrics = useLive((s) => s.metrics);
  const demo = useLive((s) => s.demo);

  const src = status?.sources;
  const onlineLogs = src?.logs?.filter((l) => l.online).length ?? 0;
  const rate = src?.rate_per_min ?? metrics?.certs_per_minute ?? 0;
  const sourceLabel =
    src?.source === 'ctlogs' || src?.source === 'hybrid'
      ? `CT logs · ${onlineLogs} log${onlineLogs === 1 ? '' : 's'} online`
      : src?.source === 'certstream'
        ? 'Certstream · online'
        : src?.source === 'replay'
          ? 'CT replay · synthetic'
          : 'CT feed';
  const connTone = connection === 'connected' ? 'text-emerald' : connection === 'offline' ? 'text-red' : 'text-amber';
  const connText = connection === 'connected' ? 'Live' : connection === 'connecting' ? 'Connecting' : connection === 'offline' ? 'Offline' : `Reconnecting${attempt > 1 ? ` (${attempt})` : ''}`;

  return (
    <header className="h-12 shrink-0 border-b border-line bg-surface/60 backdrop-blur flex items-center gap-2 px-4">
      <div className={`flex items-center gap-1.5 text-[12px] font-medium ${connTone}`} title={`WebSocket /ws: ${connection}`}>
        {connection === 'connected' ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
        <span className="relative flex size-1.5">
          {connection === 'connected' && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald opacity-60 animate-ping" />}
          <span className={`relative inline-flex size-1.5 rounded-full ${connection === 'connected' ? 'bg-emerald' : connection === 'offline' ? 'bg-red' : 'bg-amber animate-pulse-soft'}`} />
        </span>
        {connText}
      </div>

      <span className="h-4 w-px bg-line mx-1" />

      <div className="flex items-center gap-1.5 text-[12px] text-ink-2 whitespace-nowrap min-w-0" title={src ? JSON.stringify(src, null, 1) : 'Source status unknown'}>
        <Radio className={`size-3.5 shrink-0 ${src?.online ? 'text-sky' : 'text-ink-4'}`} />
        <span className="truncate">{status ? sourceLabel : 'Source…'}</span>
        <span className="text-ink-4">·</span>
        <span className="tnum text-ink">{fmtInt(rate)}</span>
        <span className="text-ink-3">certs/min</span>
        {src?.planted ? <span className="text-ink-4 text-[11px] hidden min-[1400px]:inline">· {src.planted} planted</span> : null}
      </div>

      <div className="ml-auto flex items-center gap-2 shrink-0 whitespace-nowrap">
        {demo?.running && (
          <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[11.5px] bg-gold/10 text-gold border border-gold/25" title="Scripted demo scenario is running">
            <span className="size-1.5 rounded-full bg-gold animate-pulse-soft" />
            <span className="hidden min-[1400px]:inline">scenario running · </span>
            {demo.speed}×
          </span>
        )}
        <Badge icon={<Cpu className="size-3.5" />} label="encoder" value={encoderName(status?.encoder?.name, status?.encoder?.model)} title={status?.encoder ? `${status.encoder.model} · ${status.encoder.dims} dims` : ''} />
        <Badge
          icon={<Plug className="size-3.5" />}
          label="connectors"
          value={status ? (status.connector_mode === 'live' ? 'live partners' : 'simulated partners') : '—'}
          tone={status?.connector_mode === 'live' ? 'emerald' : undefined}
        />
        <button
          onClick={onPresenter}
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium border transition-colors ${
            presenterOpen ? 'bg-gold text-[#1a1406] border-gold-2/40' : 'bg-raised text-ink border-line hover:border-line-strong'
          }`}
          title="Presenter controls (P)"
        >
          <Presentation className="size-3.5" />
          Presenter
          <kbd className={`ml-0.5 text-[10px] font-mono rounded px-1 border ${presenterOpen ? 'border-[#1a1406]/30' : 'border-line-strong text-ink-3'}`}>P</kbd>
        </button>
      </div>
    </header>
  );
}

function Badge({ icon, label, value, title, tone }: { icon: ReactNode; label: string; value: string; title?: string; tone?: 'emerald' }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] bg-sunken border border-line whitespace-nowrap" title={title ? `${label}: ${title}` : label}>
      <span className="text-ink-3">{icon}</span>
      <span className="text-ink-3 hidden min-[1400px]:inline">{label}</span>
      <span className={`font-medium ${tone === 'emerald' ? 'text-emerald' : 'text-ink'}`}>{value}</span>
    </span>
  );
}
