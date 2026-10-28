import { Link } from 'react-router-dom';
import { Mail, MessageSquare, MessageSquareWarning, Phone, Waypoints } from 'lucide-react';
import type { Campaign, Report } from '../../api/types';
import { reportChannelLabel } from '../../lib/tones';
import { Card, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { RelativeTime } from '../ui/RelativeTime';
import { SkeletonRows } from '../ui/Skeleton';

const icon = (ch: string) => (ch === 'whatsapp' ? <Phone className="size-3.5" /> : ch === 'email' ? <Mail className="size-3.5" /> : ch === 'partner' || ch === 'feed' ? <Waypoints className="size-3.5" /> : <MessageSquare className="size-3.5" />);

export function LinkedReports({ reports, loading, campaign }: { reports: Report[]; loading: boolean; campaign: Campaign | null }) {
  return (
    <Card>
      <CardHeader
        title="Linked reports"
        titleAr="البلاغات المرتبطة"
        count={reports.length || undefined}
        subtitle={campaign ? <>part of campaign <Link to={`/campaigns/${campaign.id}`} className="text-violet hover:underline">{campaign.name}</Link> · {campaign.report_ids.length} reports</> : 'forwarded messages that point at this page'}
      />
      {loading ? (
        <SkeletonRows rows={2} />
      ) : reports.length === 0 ? (
        <EmptyState icon={<MessageSquareWarning className="size-4" />} title="No citizen reports" hint="This page was caught by the certificate filter before anyone reported it." compact />
      ) : (
        <ul className="divide-y divide-line/60">
          {reports.map((r) => (
            <li key={r.id} className="py-2">
              <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
                <span className="text-violet">{icon(r.channel)}</span>
                <span className="font-medium text-ink-2">{reportChannelLabel[r.channel] ?? r.channel}</span>
                {r.sender_masked && <span className="font-mono">{r.sender_masked}</span>}
                <span className="ml-auto">
                  <RelativeTime iso={r.received_at} />
                </span>
              </div>
              <p className="text-[12px] text-ink mt-1 leading-snug" dir="auto">
                {r.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
