import { useCallback, useEffect, useState } from 'react';
import { Check, FileText, MessageSquare, Pause, Play, Power, RotateCcw, ShieldAlert, Syringe, X, Zap } from 'lucide-react';
import { api } from '../../api/client';
import type { DemoState } from '../../api/types';
import { useLive, useLiveStore } from '../../hooks/useLiveEvents';
import { useNow } from '../../hooks/useNow';
import { fmtClock, fmtDuration, parseTime } from '../../lib/format';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';

const SPEEDS = [0.5, 1, 2, 4];
const EXAMPLES = ['rta-fines-refund.com', 'salik-recharge-ae.com', 'xn--tx-refund-gov-w1k.com', 'dewa-bill-pay.com', 'www.rta.ae'];
const ISSUERS = ["Let's Encrypt (R12)", 'ZeroSSL (ZeroSSL RSA Domain Secure Site CA)', 'Google Trust Services (WE1)', 'Sectigo Limited (Sectigo RSA Domain Validation Secure Server CA)'];

const kindIcon = (kind: string) =>
  kind === 'cert' ? <ShieldAlert className="size-3.5" /> : kind === 'report' ? <MessageSquare className="size-3.5" /> : kind === 'activate' ? <Power className="size-3.5" /> : <FileText className="size-3.5" />;

export function PresenterDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useLiveStore();
  const demo = useLive((s) => s.demo);
  const log = useLive((s) => s.eventLog);
  const { toast } = useToast();
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [issuer, setIssuer] = useState(ISSUERS[0]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    api.demo().then((d) => store.setDemo(d)).catch(() => undefined);
  }, [open, store]);

  const run = useCallback(
    async (key: string, fn: () => Promise<DemoState | unknown>, ok?: string) => {
      setBusy(key);
      try {
        const res = await fn();
        if (res && typeof res === 'object' && 'steps' in (res as DemoState)) store.setDemo(res as DemoState);
        if (ok) toast({ title: ok, tone: 'emerald' });
      } catch (e) {
        toast({ title: 'Demo control failed', description: e instanceof Error ? e.message : String(e), tone: 'red' });
      } finally {
        setBusy(null);
      }
    },
    [store, toast],
  );

  if (!open) return null;

  const started = parseTime(demo?.started_at);
  const elapsedMs = demo?.running && started ? (now - started) * (demo.speed || 1) : (demo?.elapsed_s ?? 0) * 1000;

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-[400px] bg-surface border-l border-line shadow-pop flex flex-col animate-drawer-in" aria-label="Presenter controls">
      <header className="h-12 px-4 flex items-center justify-between border-b border-line">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-gold" />
          <h2 className="text-[13.5px] font-semibold">Presenter</h2>
          <span className="arabic text-[12px] text-ink-3">العرض</span>
        </div>
        <button onClick={onClose} className="text-ink-3 hover:text-ink p-1 -m-1 rounded" aria-label="Close presenter">
          <X className="size-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* scenario */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="label-xs">Scenario</h3>
            {demo ? (
              <span className={`inline-flex items-center gap-1.5 text-[11.5px] ${demo.running ? 'text-gold' : 'text-ink-3'}`}>
                <span className={`size-1.5 rounded-full ${demo.running ? 'bg-gold animate-pulse-soft' : 'bg-ink-4'}`} />
                {demo.available ? (demo.running ? 'running' : 'stopped') : 'unavailable'}
                <span className="tnum text-ink-3">· t+{fmtDuration(elapsedMs)}</span>
              </span>
            ) : (
              <span className="text-[11.5px] text-ink-4">loading…</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {demo?.running ? (
              <Button size="sm" variant="subtle" icon={<Pause className="size-3.5" />} loading={busy === 'stop'} onClick={() => run('stop', api.demoStop, 'Scenario paused')}>
                Stop
              </Button>
            ) : (
              <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} loading={busy === 'start'} onClick={() => run('start', () => api.demoStart(demo?.speed), 'Scenario started')} disabled={demo ? !demo.available : false}>
                Start
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              icon={<RotateCcw className="size-3.5" />}
              loading={busy === 'reset'}
              onClick={() => {
                if (window.confirm('Reset the demo? This wipes cases, candidates and reports (the registry is kept).')) void run('reset', api.demoReset, 'Demo reset');
              }}
            >
              Reset
            </Button>
            <div className="ml-auto inline-flex items-center rounded-md border border-line bg-sunken p-0.5" title="Scenario speed">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => run(`speed${s}`, () => api.demoStart(s))}
                  className={`h-6 px-2 rounded-[5px] text-[11.5px] tnum ${demo?.speed === s ? 'bg-raised text-ink border border-line-strong' : 'text-ink-3 hover:text-ink border border-transparent'}`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
          {demo?.sites_url && (
            <p className="text-[11px] text-ink-4 mt-2 truncate" title={demo.sites_url}>
              demo sites served at <span className="font-mono text-ink-3">{demo.sites_url}</span>
            </p>
          )}
        </section>

        {/* steps */}
        <section>
          <h3 className="label-xs mb-2">Steps</h3>
          {!demo ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-9" />
              ))}
            </div>
          ) : demo.steps.length === 0 ? (
            <p className="text-[12px] text-ink-3">No scripted steps.</p>
          ) : (
            <ol className="space-y-1">
              {demo.steps.map((s) => (
                <li key={s.id} className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 ${s.fired ? 'border-line bg-sunken/50' : 'border-line bg-surface'}`}>
                  <span className={`shrink-0 ${s.fired ? 'text-emerald' : 'text-ink-3'}`}>{s.fired ? <Check className="size-3.5" /> : kindIcon(s.kind)}</span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[12px] leading-snug truncate ${s.fired ? 'text-ink-3' : 'text-ink'}`} title={s.label}>
                      {s.label}
                    </p>
                    <p className="text-[10.5px] tnum text-ink-4">
                      t+{s.at_s}s · {s.kind}
                      {s.fired && s.fired_at ? ` · fired ${fmtClock(s.fired_at)}` : ''}
                    </p>
                  </div>
                  <Button size="xs" variant={s.fired ? 'ghost' : 'outline'} loading={busy === `step:${s.id}`} onClick={() => run(`step:${s.id}`, () => api.demoStep(s.id), `Fired: ${s.label}`)} title="Fire this step now">
                    {s.fired ? 'Again' : 'Fire now'}
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* inject */}
        <section>
          <h3 className="label-xs mb-2">Inject a certificate</h3>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const d = domain.trim().toLowerCase();
              if (!d) return;
              void run('inject', () => api.demoInject(d, issuer), `Planted ${d} in the live feed`).then(() => setDomain(''));
            }}
          >
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="domain, e.g. rta-fines-refund.com" className="field w-full font-mono" spellCheck={false} />
            <div className="flex items-center gap-2">
              <select value={issuer} onChange={(e) => setIssuer(e.target.value)} className="field flex-1 min-w-0">
                {ISSUERS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
              <Button type="submit" size="md" variant="primary" icon={<Syringe className="size-3.5" />} loading={busy === 'inject'} disabled={!domain.trim()}>
                Inject
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" onClick={() => setDomain(x)} className="font-mono text-[10.5px] text-ink-3 hover:text-ink bg-sunken border border-line rounded px-1.5 py-0.5">
                  {x}
                </button>
              ))}
            </div>
          </form>
        </section>

        {/* event log */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="label-xs">Event log</h3>
            <span className="text-[11px] text-ink-4 tnum">{log.length} events</span>
          </div>
          {log.length === 0 ? (
            <p className="text-[12px] text-ink-3">Waiting for pipeline events…</p>
          ) : (
            <ul className="space-y-1 font-mono text-[11px]">
              {log.slice(0, 40).map((l) => (
                <li key={l.id} className="flex gap-2 leading-snug">
                  <span className="text-ink-4 tnum shrink-0">{fmtClock(l.at)}</span>
                  <span className={`shrink-0 w-[78px] truncate ${l.type === 'case' ? 'text-red' : l.type === 'action' ? 'text-sky' : l.type === 'candidate' ? 'text-amber' : l.type === 'evidence' ? 'text-emerald' : 'text-ink-3'}`}>{l.type}</span>
                  <span className="text-ink-2 truncate" title={l.summary}>
                    {l.summary}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <footer className="px-4 py-2 border-t border-line text-[11px] text-ink-4 flex items-center justify-between">
        <span>
          press <kbd className="font-mono border border-line-strong rounded px-1">P</kbd> to toggle
        </span>
        <span>POST /api/demo/*</span>
      </footer>
    </aside>
  );
}
