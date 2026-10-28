import { FormInput } from 'lucide-react';
import type { FormInfo } from '../../api/types';
import { sensitiveCategories } from '../../lib/tones';
import { Card, CardHeader } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { EmptyState } from '../ui/EmptyState';
import { SkeletonRows } from '../ui/Skeleton';

const hostOf = (action: string) => {
  try {
    return action ? new URL(action, 'https://x').host : '';
  } catch {
    return action;
  }
};

export function FormFieldsTable({ forms, formSummary, loading }: { forms: FormInfo[] | null; formSummary: string; loading: boolean }) {
  const fields = (forms ?? []).flatMap((f, fi) => f.fields.map((x) => ({ ...x, formIndex: fi, action: f.action, submit: f.submit_text, method: f.method })));
  const sensitive = fields.filter((f) => sensitiveCategories.has(f.category)).length;
  const actionHosts = [...new Set((forms ?? []).map((f) => hostOf(f.action)).filter(Boolean))];

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="px-4 pt-4">
        <CardHeader
          title="What the form asks for"
          titleAr="حقول النموذج"
          count={fields.length || undefined}
          subtitle={
            loading ? 'loading…' : fields.length ? (
              <>
                <span className={sensitive ? 'text-red' : ''}>{sensitive} sensitive</span> of {fields.length} fields{actionHosts.length ? ` · posts to ${actionHosts.join(', ')}` : ''}
                {(forms ?? [])[0]?.submit_text ? ` · “${(forms ?? [])[0].submit_text}”` : ''}
              </>
            ) : (
              formSummary || 'No form captured'
            )
          }
        />
      </div>
      {loading ? (
        <div className="px-4 pb-4">
          <SkeletonRows rows={4} />
        </div>
      ) : fields.length === 0 ? (
        <EmptyState icon={<FormInput className="size-4" />} title="No input fields" hint="The captured page does not collect data — typical for inactive or official pages." compact />
      ) : (
        <table className="w-full text-[12px]">
          <thead className="bg-sunken/70 border-y border-line label-xs text-left">
            <tr>
              <th className="px-4 h-7 font-medium">Field</th>
              <th className="px-3 h-7 font-medium">Type</th>
              <th className="px-3 h-7 font-medium">Category</th>
              <th className="px-4 h-7 font-medium text-right">Sensitivity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {fields.map((f, i) => {
              const hot = sensitiveCategories.has(f.category);
              return (
                <tr key={`${f.formIndex}-${f.name}-${i}`} className={hot ? 'bg-red/[0.04]' : ''}>
                  <td className="px-4 py-1.5">
                    <div className="text-ink">{f.label || f.placeholder || f.name || f.id || '—'}</div>
                    {(f.name || f.autocomplete) && (
                      <div className="font-mono text-[10.5px] text-ink-4 truncate">
                        {f.name}
                        {f.autocomplete ? ` · autocomplete=${f.autocomplete}` : ''}
                        {f.maxlength ? ` · max ${f.maxlength}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-ink-3">{f.type || 'text'}</td>
                  <td className="px-3 py-1.5">
                    <Chip tone={hot ? 'red' : f.category === 'other' ? 'slate' : 'amber'} size="xs" mono>
                      {f.category}
                    </Chip>
                  </td>
                  <td className="px-4 py-1.5">
                    <div className="flex justify-end gap-0.5" title={`sensitivity ${f.sensitivity}/3`}>
                      {[1, 2, 3].map((n) => (
                        <span key={n} className={`size-1.5 rounded-full ${n <= f.sensitivity ? (f.sensitivity >= 3 ? 'bg-red' : 'bg-amber') : 'bg-line-strong'}`} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
