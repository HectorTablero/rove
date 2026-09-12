import type { ExtractionDto, MentionDto } from '@rove/shared';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from './apiClient';

/* The client side of a paste: the two server calls a browser cannot make itself, and the
   geocoder behind its key. All three are plain requests — nothing here touches the local store,
   which is what lets the add screen decide, per step, what to keep. */

export interface ResolvedSnapshot {
  sourceId: string;
  fetchedAt: string;
  canonicalUrl: string | null;
  contentType: string;
  body: string;
  text: string;
  error: string | null;
  title: string | null;
}

export const resolveUrl = (url: string, region: string) =>
  apiPost<ResolvedSnapshot>('/ingest/resolve', { url, region });

export const extractMentions = (text: string) =>
  apiPost<ExtractionDto & { mentions: MentionDto[] }>('/ingest/extract', { text });

export interface GeocodeCandidate {
  name: string;
  district: string | null;
  location: {
    point: { lon: number; lat: number; datum: 'WGS84' | 'GCJ02' | 'BD09' };
    address: string | null;
    providerRef: { provider: string; id: string } | null;
  };
}

export const suggestPlaces = (q: string, region: string) =>
  apiGet<{ candidates: GeocodeCandidate[] }>(
    `/geocode/suggest?${new URLSearchParams({ q, region })}`,
  ).then((r) => r.candidates);

export interface GeocodeUsage {
  configured: boolean;
  month: string;
  calls: number;
  limit: number;
  stopAt: number;
}

/** Suggestions for a query, debounced by the caller; two characters is the floor. */
export const useSuggestions = (query: string, region: string) =>
  useQuery({
    queryKey: ['geocode', 'suggest', region, query],
    queryFn: () => suggestPlaces(query, region),
    enabled: query.trim().length >= 2,
    staleTime: Infinity,
    retry: false,
  });

export const useGeocodeUsage = (region: string, enabled = true) =>
  useQuery({
    queryKey: ['geocode', 'usage', region],
    queryFn: () => apiGet<GeocodeUsage>(`/geocode/usage?${new URLSearchParams({ region })}`),
    enabled,
    retry: false,
  });
