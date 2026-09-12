import { SOURCES, type RegionDescriptor, type SourceManifest } from '@rove/shared';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from './apiClient';

/* The feeds, from the client: which ones this region can poll, what each did last, and a button. */

export interface SourceStatus {
  sourceId: string;
  down: boolean;
  lastRun: {
    at: string;
    ok: boolean;
    found: number;
    created: number;
    error: string | null;
    trigger: string;
  } | null;
}

export interface RunSummary {
  sourceId: string;
  ok: boolean;
  found: number;
  created: number;
  error: string | null;
}

export const pollableSources = (region: RegionDescriptor): SourceManifest[] =>
  SOURCES.filter((s) => s.polls && (s.regionIds === '*' || s.regionIds.includes(region.id)));

export const useSourceStatus = (enabled: boolean) =>
  useQuery({
    queryKey: ['sources', 'status'],
    queryFn: () => apiGet<{ sources: SourceStatus[] }>('/sources/status').then((r) => r.sources),
    enabled,
    retry: false,
    staleTime: 60_000,
  });

export const pollNow = (sourceId?: string) =>
  apiPost<{ runs: RunSummary[] }>('/sources/poll', sourceId ? { sourceId } : {}).then(
    (r) => r.runs,
  );
