import type { ReactNode } from 'react';
import { Banknote, Bitcoin, Mail, MessageCircle, Phone, Tags } from 'lucide-react';
import { humanize } from '../../lib/format';
import { Card, CardHeader } from '../ui/Card';
import { CopyButton } from '../ui/CopyButton';
import { EmptyState } from '../ui/EmptyState';
import { SkeletonRows } from '../ui/Skeleton';

const META: Record<string, { label: string; icon: ReactNode; hint: string }> = {
  ibans: { label: 'IBANs', icon: <Banknote className="size-3.5" />, hint: 'sent to the receiving bank for freezing' },
  phones: { label: 'Phone numbers', icon: <Phone className="size-3.5" />, hint: 'sent to telecom operators' },
  whatsapp: { label: 'WhatsApp', icon: <MessageCircle className="size-3.5" />, hint: 'reported for account action' },
  emails: { label: 'Emails', icon: <Mail className="size-3.5" />, hint: 'mailbox providers notified' },
  crypto_wallets: { label: 'Crypto wallets', icon: <Bitcoin className="size-3.5" />, hint: 'exchanges and chain-analysis partners' },
};

export function IocPanel({ iocs, loading }: { iocs: Record<string, string[]>; loading: boolean }) {
  const groups = Object.entries(iocs).filter(([, v]) => Array.isArray(v) && v.length > 0);
  const all = groups.flatMap(([, v]) => v);
  return (
    <Card>
      <CardHeader
        title="Indicators"
        titleAr="المؤشرات المالية"
        count={all.length || undefined}
        subtitle="payment and contact details shown on the page"
        actions={all.length > 0 ? <CopyButton text={all.join('\n')} label="all indicators" /> : undefined}
      />
      {loading ? (
        <SkeletonRows rows={3} />
      ) : groups.length === 0 ? (
        <EmptyState icon={<Tags className="size-4" />} title="No indicators" hint="No IBANs, wallets or contact numbers were found on the page." compact />
      ) : (
        <div className="space-y-3">
          {groups.map(([k, vals]) => {
            const m = META[k];
            return (
              <div key={k}>
                <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3 mb-1">
                  <span className="text-ink-4">{m?.icon ?? <Tags className="size-3.5" />}</span>
                  <span className="font-medium text-ink-2">{m?.label ?? humanize(k)}</span>
                  <span className="text-ink-4">· {m?.hint ?? ''}</span>
                </div>
                <ul className="space-y-1">
                  {vals.map((v) => (
                    <li key={v} className="flex items-center justify-between gap-2 rounded-md bg-sunken/70 border border-line px-2.5 py-1.5">
                      <span className="font-mono text-[12px] text-ink break-all" dir="ltr">
                        {v}
                      </span>
                      <CopyButton text={v} label={m?.label ?? k} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
