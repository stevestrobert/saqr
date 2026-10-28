import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FolderX } from 'lucide-react';
import { api } from '../api/client';
import type { Action, ApproveResponse, CaseSummary, Candidate } from '../api/types';
import { CHANNELS } from '../api/types';
import { useFetch } from '../hooks/useFetch';
import { useLive, useLiveStore } from '../hooks/useLiveEvents';
import { toUnicodeDomain } from '../lib/format';
import { CaseHeader } from '../components/case/CaseHeader';
import { TimelineStrip } from '../components/case/TimelineStrip';
import { ScreenshotCompare } from '../components/case/ScreenshotCompare';
import { SignalsPanel } from '../components/case/SignalsPanel';
import { FormFieldsTable } from '../components/case/FormFieldsTable';
import { PageText } from '../components/case/PageText';
import { IocPanel } from '../components/case/IocPanel';
import { InfraPanel } from '../components/case/InfraPanel';
import { EvidenceCard } from '../components/case/EvidenceCard';
import { ResponseCard } from '../components/case/ResponseCard';
import { LinkedReports } from '../components/case/LinkedReports';
import { Card } from '../components/ui/Card';
import { EmptyState, ErrorState } from '../components/ui/EmptyState';
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton';
import { LinkButton } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';

export function CaseDetail() {
  const { id = '' } = useParams();
  const store = useLiveStore();
  const { toast } = useToast();
  const { data, loading, error, status, reload, setData } = useFetch(() => api.case(id), [id]);
  const liveSummary = useLive((s) => s.cases[id]);
  const liveActions = useLive((s) => s.actions[id]);
  const liveEvidence = useLive((s) => s.evidence[id]);

  // Re-fetch the full detail (silently) when the live summary or evidence for this case changes.
  const skipFirst = useRef(true);
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    if (!data) return;
    const t = window.setTimeout(() => void reload(true), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSummary, liveEvidence]);

  const summary: CaseSummary | null = liveSummary ?? data?.summary ?? null;

  useEffect(() => {
    document.title = summary ? `${toUnicodeDomain(summary.domain)} · SAQR` : 'Case · SAQR';
  }, [summary]);

  const actions = useMemo<Action[]>(() => {
    const m = new Map<string, Action>();
    for (const a of data?.actions ?? []) m.set(a.id, a);
    for (const a of Object.values(liveActions ?? {})) m.set(a.id, a);
    return [...m.values()].sort((a, b) => CHANNELS.indexOf(a.channel) - CHANNELS.indexOf(b.channel) || a.target.localeCompare(b.target));
  }, [data, liveActions]);

  const onApproved = useCallback(
    (res: ApproveResponse) => {
      setData((prev) => (prev ? { ...prev, summary: res.case, actions: res.actions } : prev));
      store.mergeCases([res.case]);
      store.mergeActions(res.actions);
      toast({ title: 'Approved — takedown and blocking requests dispatched', description: `${res.actions.length} requests sent to partners`, tone: 'emerald' });
    },
    [setData, store, toast],
  );

  const onDismissed = useCallback(
    (s: CaseSummary) => {
      setData((prev) => (prev ? { ...prev, summary: s } : prev));
      store.mergeCases([s]);
      toast({ title: 'Dismissed as false positive', tone: 'slate' });
    },
    [setData, store, toast],
  );

  const onRechecked = useCallback(
    (c: Candidate) => {
      toast({ title: 'Re-check queued', description: `${c.domain} will be opened again in the isolated browser`, tone: 'sky' });
      window.setTimeout(() => void reload(true), 1500);
    },
    [toast, reload],
  );

  if (loading && !summary) {
    return (
      <div className="space-y-4">
        <Card>
          <div className="flex items-start gap-4">
            <div className="flex-1 space-y-2.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-80" />
              <Skeleton className="h-3 w-[60%]" />
            </div>
            <Skeleton className="size-[72px] rounded-full" />
          </div>
        </Card>
        <Card>
          <Skeleton className="h-10 w-full" />
        </Card>
        <div className="grid grid-cols-[minmax(0,1fr)_400px] gap-4">
          <div className="space-y-4">
            <Card>
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="aspect-[16/10]" />
                <Skeleton className="aspect-[16/10]" />
              </div>
            </Card>
            <Card>
              <SkeletonCard lines={6} />
            </Card>
          </div>
          <div className="space-y-4">
            <Card>
              <SkeletonCard lines={5} />
            </Card>
            <Card>
              <SkeletonCard lines={7} />
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <Card>
        {status === 404 ? (
          <EmptyState icon={<FolderX className="size-4" />} title="Case not found" hint={`No case with id ${id}. It may have been wiped by a demo reset.`} action={<LinkButton to="/cases" variant="outline" size="sm">Back to cases</LinkButton>} />
        ) : (
          <ErrorState message={error ?? 'Unknown error'} onRetry={() => reload()} />
        )}
      </Card>
    );
  }

  const detail = data ?? null;
  const kase = detail?.case ?? null;

  return (
    <div className="space-y-4">
      <nav className="text-[11.5px] text-ink-3 -mb-2">
        <Link to="/cases" className="hover:text-ink">
          Cases
        </Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="font-mono text-ink-2">{summary.id}</span>
      </nav>
      <CaseHeader summary={summary} detail={detail} />
      <TimelineStrip summary={summary} evidence={detail?.evidence ?? null} />

      <div className="grid grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <ScreenshotCompare summary={summary} reference={detail?.reference ?? null} />
          <div className="grid grid-cols-2 gap-4">
            <SignalsPanel summary={summary} verdict={kase?.verdict ?? null} />
            <FormFieldsTable forms={kase?.capture.forms ?? null} formSummary={summary.verdict.form_summary} loading={!detail} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <PageText excerpt={detail?.capture_text_excerpt ?? ''} capture={kase?.capture ?? null} text={kase?.verdict.text ?? null} loading={!detail} />
            <IocPanel iocs={{ ...(kase?.iocs ?? {}), ...(detail?.evidence?.iocs ?? {}) }} loading={!detail} />
          </div>
          <InfraPanel capture={kase?.capture ?? null} evidence={detail?.evidence ?? null} candidate={detail?.candidate ?? null} loading={!detail} />
        </div>

        <div className="space-y-4 min-w-0">
          <ResponseCard summary={summary} actions={actions} onApproved={onApproved} onDismissed={onDismissed} onRechecked={onRechecked} />
          <EvidenceCard summary={summary} evidence={detail?.evidence ?? null} building={!detail?.evidence && !summary.has_evidence} />
          <LinkedReports reports={detail?.reports ?? []} loading={!detail} campaign={detail?.campaign ?? null} />
        </div>
      </div>
    </div>
  );
}
