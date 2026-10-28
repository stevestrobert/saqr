import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle, Zap } from 'lucide-react';
import { api } from '../../api/client';
import type { ApproveResponse, CaseSummary, Channel, Connector } from '../../api/types';
import { CHANNELS } from '../../api/types';
import { toUnicodeDomain } from '../../lib/format';
import { channelLabel, verdictLabel } from '../../lib/tones';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { channelIcon } from './ResponseCard';

export function ApproveModal({ open, onClose, summary, connectors, onApproved }: { open: boolean; onClose: () => void; summary: CaseSummary; connectors: Connector[]; onApproved: (r: ApproveResponse) => void }) {
  const { toast } = useToast();
  const [actor, setActor] = useState('analyst@demo');
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<Set<Channel>>(new Set(CHANNELS));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected(new Set(connectors.length ? connectors.map((c) => c.channel) : CHANNELS));
      setErr(null);
    }
  }, [open, connectors]);

  const allowlisted = useMemo(() => {
    if (summary.verdict.label === 'official') return true;
    const pd = summary.protected_domain;
    return !!pd && (summary.domain === pd || summary.domain.endsWith(`.${pd}`));
  }, [summary]);

  const verdictOk = summary.verdict.label === 'confirmed_fake' || summary.verdict.label === 'suspicious';
  const channels = connectors.length ? [...new Set(connectors.map((c) => c.channel))] : CHANNELS;
  const targetsFor = (ch: Channel) => connectors.filter((c) => c.channel === ch).flatMap((c) => c.targets);

  const toggle = (ch: Channel) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(ch)) n.delete(ch);
      else n.add(ch);
      return n;
    });

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const all = channels.every((c) => selected.has(c));
      const res = await api.approve(summary.id, { actor: actor.trim(), channels: all ? undefined : [...selected], note: note.trim() || undefined });
      onApproved(res);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      toast({ title: 'Approval refused', description: msg, tone: 'red' });
    } finally {
      setSubmitting(false);
    }
  };

  const safeguards = [
    {
      ok: !allowlisted,
      label: 'Not on the official allow-list',
      detail: allowlisted ? `${summary.domain} is an official property — the backend will refuse to block it (409).` : `${toUnicodeDomain(summary.domain)} is neither ${summary.protected_domain ?? 'an official domain'} nor one of its subdomains.`,
    },
    {
      ok: verdictOk,
      label: `Verdict ${verdictLabel[summary.verdict.label]} · risk ${summary.verdict.risk}/100 · confidence ${Math.round(summary.verdict.confidence * 100)}%`,
      detail: summary.verdict.explanations[0] ?? summary.verdict.form_summary,
    },
    {
      ok: summary.has_evidence,
      warn: !summary.has_evidence,
      label: summary.has_evidence ? 'Evidence package sealed and time-stamped' : 'Evidence package still building',
      detail: summary.has_evidence ? 'Screenshots, HTML, DNS, WHOIS, certificate and hashes are attached to every request.' : 'Requests will reference the package once it is sealed.',
    },
    {
      ok: actor.trim().length > 0,
      label: 'Human sign-off',
      detail: 'Your name is written to the hash-chained audit log together with the verdict, the evidence hash and every request sent.',
    },
  ];
  const blocked = allowlisted || !actor.trim() || selected.size === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <Zap className="size-4 text-gold" /> Approve &amp; block everywhere
        </span>
      }
      subtitle={
        <>
          <span className="font-mono text-ink-2">{toUnicodeDomain(summary.domain)}</span> · imitates {summary.protected_entity ?? 'an official service'}
        </>
      }
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" size="md" loading={submitting} disabled={blocked} onClick={submit} icon={<Zap className="size-3.5" />}>
            Approve &amp; dispatch {selected.size} channel{selected.size === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <section>
          <h3 className="label-xs mb-2">Safeguards</h3>
          <ul className="space-y-1.5">
            {safeguards.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[12.5px]">
                {s.ok ? <CheckCircle2 className="size-4 text-emerald shrink-0 mt-px" /> : s.warn ? <AlertTriangle className="size-4 text-amber shrink-0 mt-px" /> : <XCircle className="size-4 text-red shrink-0 mt-px" />}
                <div>
                  <div className={`${s.ok ? 'text-ink' : s.warn ? 'text-amber' : 'text-red'} font-medium`}>{s.label}</div>
                  {s.detail && <div className="text-[12px] text-ink-3 leading-snug">{s.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid grid-cols-[1fr_1fr] gap-3">
          <label className="block">
            <span className="label-xs">Analyst</span>
            <input value={actor} onChange={(e) => setActor(e.target.value)} className="field w-full mt-1" placeholder="analyst@demo" required />
          </label>
          <label className="block">
            <span className="label-xs">Note (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="field w-full mt-1" placeholder="e.g. matches SMS wave reported by du" />
          </label>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="label-xs">Channels</h3>
            <div className="flex gap-2 text-[11.5px]">
              <button className="text-gold hover:text-gold-2" onClick={() => setSelected(new Set(channels))}>
                all
              </button>
              <button className="text-ink-3 hover:text-ink" onClick={() => setSelected(new Set())}>
                none
              </button>
            </div>
          </div>
          <ul className="grid grid-cols-2 gap-1.5">
            {channels.map((ch) => {
              const on = selected.has(ch);
              const targets = targetsFor(ch);
              return (
                <li key={ch}>
                  <label className={`flex items-start gap-2.5 rounded-md border p-2.5 cursor-pointer transition-colors ${on ? 'border-gold/40 bg-gold/[0.06]' : 'border-line bg-sunken/40 hover:border-line-strong'}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(ch)} className="mt-0.5 accent-[#e3b341]" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[12.5px] text-ink font-medium">
                        <span className="text-ink-3">{channelIcon(ch)}</span>
                        {channelLabel[ch]}
                      </div>
                      <div className="text-[11.5px] text-ink-3 leading-snug truncate" title={targets.join(', ')}>
                        {targets.length ? targets.join(' · ') : 'configured partner'}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        {err && (
          <p className="text-[12.5px] text-red flex items-center gap-2">
            <XCircle className="size-4" /> {err}
          </p>
        )}
        <p className="text-[11.5px] text-ink-4 flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" /> Official domains can never be blocked — the allow-list is checked again server-side.
        </p>
      </div>
    </Modal>
  );
}
