import { useState } from 'react';
import { Ban } from 'lucide-react';
import { api } from '../../api/client';
import type { CaseSummary } from '../../api/types';
import { toUnicodeDomain } from '../../lib/format';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';

const REASONS = ['Legitimate business unrelated to the imitated entity', 'Official property not yet in the registry', 'Parked domain with no content', 'Security researcher / brand-protection test', 'Duplicate of an existing case'];

export function DismissModal({ open, onClose, summary, onDismissed }: { open: boolean; onClose: () => void; summary: CaseSummary; onDismissed: (s: CaseSummary) => void }) {
  const { toast } = useToast();
  const [actor, setActor] = useState('analyst@demo');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const s = await api.dismiss(summary.id, { actor: actor.trim(), reason: reason.trim() });
      onDismissed(s);
      onClose();
      setReason('');
    } catch (e) {
      toast({ title: 'Could not dismiss', description: e instanceof Error ? e.message : String(e), tone: 'red' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Dismiss as false positive"
      subtitle={
        <>
          <span className="font-mono text-ink-2">{toUnicodeDomain(summary.domain)}</span> will be closed and no partner contacted
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="danger" loading={submitting} disabled={!reason.trim() || !actor.trim()} onClick={submit} icon={<Ban className="size-3.5" />}>
            Dismiss case
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="label-xs">Analyst</span>
          <input value={actor} onChange={(e) => setActor(e.target.value)} className="field w-full mt-1" />
        </label>
        <label className="block">
          <span className="label-xs">Reason (required, written to the audit log)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="field w-full mt-1 resize-y" placeholder="Why is this not an impersonation?" />
        </label>
        <div className="flex flex-wrap gap-1">
          {REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className="text-[11px] text-ink-3 hover:text-ink bg-sunken border border-line rounded px-1.5 py-0.5">
              {r}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
