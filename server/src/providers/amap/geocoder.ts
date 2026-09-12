import { regionById } from '@rove/shared';
import { config } from '../../config';
import { HttpError } from '../../errors';
import { trackEvent } from '../../lib/telemetry';
import { currentMonth, GeocodeCache, ProviderUsage } from '../../models/geocodeCache';
import type { GeocodeCandidate, Geocoder, GeocoderUsage } from '../geocoder';

/* Amap's Web Service API — https://lbs.amap.com/api/webservice/guide/api/inputtips
 *
 * One endpoint, 输入提示 (input tips), for both suggesting while typing and resolving the chosen
 * name: its answers carry coordinates and a POI id, so the more expensive 关键字搜索 is never
 * needed. Both count against the same monthly 基础搜索服务 pool, which on the personal tier is
 * 5,000 calls. The cache and the counter below are what keep a month of use under that.
 *
 * Everything Amap returns is GCJ-02 and is tagged so on the way out. The `city` parameter is the
 * region's name, with `citylimit=true` so a search for 星巴克 does not answer with Beijing. */

const ENDPOINT = 'https://restapi.amap.com/v3/assistant/inputtips';
/** Amap's personal-tier monthly pool for 基础搜索服务, as documented on lbs.amap.com/upgrade. */
export const AMAP_SEARCH_POOL = 5000;
/** The app refuses new searches here rather than silently failing at the pool's edge. */
export const AMAP_SEARCH_STOP_AT = 4500;

interface AmapTip {
  id: string | [];
  name: string;
  district: string | [];
  adcode: string | [];
  /** `"lon,lat"`, or `[]` when the tip is a category rather than a place. */
  location: string | [];
  address: string | [];
}

interface AmapTipsResponse {
  status: '0' | '1';
  info: string;
  infocode: string;
  tips?: AmapTip[];
}

/** Amap sends `[]` for an absent string field. */
const str = (value: string | [] | undefined): string => (typeof value === 'string' ? value : '');

/** Case- and width-folded, whitespace-collapsed: the cache key and what Amap is asked. */
export const foldQuery = (query: string): string =>
  query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

async function countCall(): Promise<number> {
  const usage = await ProviderUsage.findOneAndUpdate(
    { provider: 'amap', month: currentMonth() },
    { $inc: { calls: 1 } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  return usage?.calls ?? 0;
}

async function callsThisMonth(): Promise<number> {
  const usage = await ProviderUsage.findOne({ provider: 'amap', month: currentMonth() }).lean();
  return usage?.calls ?? 0;
}

export const amapGeocoder: Geocoder = {
  id: 'amap',

  configured: () => config.amapWebServiceKey.length > 0,

  async suggest(query, regionId) {
    const folded = foldQuery(query);
    if (!folded) return [];
    if (!this.configured()) throw new HttpError(503, 'geocode.not_configured');

    const cached = await GeocodeCache.findOne({ provider: 'amap', regionId, query: folded }).lean();
    if (cached) return cached.candidates as GeocodeCandidate[];

    /* Checked before the call, and the counter is bumped before it too: a request that fails
       halfway still spent a call on Amap's side, so it must count here as well. */
    if ((await callsThisMonth()) >= AMAP_SEARCH_STOP_AT) {
      trackEvent('geocode_quota_refused', { provider: 'amap' });
      throw new HttpError(429, 'geocode.quota');
    }
    const calls = await countCall();

    const region = regionById(regionId);
    const params = new URLSearchParams({
      key: config.amapWebServiceKey,
      keywords: folded,
      city: region.name,
      citylimit: 'true',
      // Places only: without this a tip can be a bus route or a bare category with no location.
      datatype: 'poi',
      output: 'JSON',
    });
    let payload: AmapTipsResponse;
    try {
      const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(10_000) });
      payload = (await res.json()) as AmapTipsResponse;
    } catch {
      throw new HttpError(502, 'geocode.upstream');
    }
    if (payload.status !== '1') {
      /* Amap answers 200 with `status: "0"` for a bad key, an exhausted quota or a malformed
         request, and `infocode` says which. Loud: an empty picker with no reason is exactly the
         silent failure the brief forbids. */
      trackEvent('geocode_upstream_error', { provider: 'amap', infocode: payload.infocode });
      throw new HttpError(502, `geocode.upstream:${payload.infocode}`);
    }

    const candidates: GeocodeCandidate[] = (payload.tips ?? [])
      .filter((tip) => typeof tip.location === 'string' && tip.location.includes(','))
      .map((tip) => {
        const [lon, lat] = (tip.location as string).split(',').map(Number);
        return {
          name: tip.name,
          district: str(tip.district) || null,
          location: {
            point: { lon, lat, datum: 'GCJ02' as const },
            address: [str(tip.district), str(tip.address)].filter(Boolean).join(' ') || null,
            providerRef: str(tip.id) ? { provider: 'amap', id: str(tip.id) } : null,
          },
        };
      });

    await GeocodeCache.updateOne(
      { provider: 'amap', regionId, query: folded },
      { $setOnInsert: { candidates } },
      { upsert: true },
    );
    trackEvent('geocode_call', { provider: 'amap', calls, results: candidates.length });
    return candidates;
  },

  async usage(): Promise<GeocoderUsage> {
    return {
      month: currentMonth(),
      calls: await callsThisMonth(),
      limit: AMAP_SEARCH_POOL,
      stopAt: AMAP_SEARCH_STOP_AT,
    };
  },
};
