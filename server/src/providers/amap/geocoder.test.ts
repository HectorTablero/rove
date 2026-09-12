import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modelDouble, query, resetModels } from '../../test/mongooseDouble';

/* The two promises the geocoder makes to the quota: never call Amap for a query already answered,
   and refuse — loudly, with a code — before the pool's edge rather than fail at it. */

const GeocodeCache = modelDouble();
const ProviderUsage = modelDouble();

vi.mock('../../models/geocodeCache', () => ({
  GeocodeCache,
  ProviderUsage,
  currentMonth: () => '2026-09',
}));
vi.mock('../../config', () => ({ config: { amapWebServiceKey: 'test-key' } }));

const { amapGeocoder, AMAP_SEARCH_STOP_AT, foldQuery } = await import('./geocoder');

const tipsResponse = (tips: unknown[]) =>
  vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ status: '1', infocode: '10000', tips }) });

beforeEach(() => {
  resetModels(GeocodeCache, ProviderUsage);
  ProviderUsage.findOneAndUpdate.mockReturnValue(query({ calls: 1 }));
});

afterEach(() => vi.unstubAllGlobals());

describe('amapGeocoder.suggest', () => {
  it('answers from the cache without touching the network', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    GeocodeCache.findOne.mockReturnValue(query({ candidates: [{ name: 'cached' }] }));

    const result = await amapGeocoder.suggest(' 文和友 ', 'shenzhen');

    expect(result).toEqual([{ name: 'cached' }]);
    expect(fetch).not.toHaveBeenCalled();
    expect(GeocodeCache.findOne).toHaveBeenCalledWith({
      provider: 'amap',
      regionId: 'shenzhen',
      query: foldQuery(' 文和友 '),
    });
  });

  it('tags every point GCJ-02, wraps the POI id opaquely, and caches the answer', async () => {
    vi.stubGlobal(
      'fetch',
      tipsResponse([
        {
          id: 'B0FFFAB6J2',
          name: '文和友',
          district: '深圳市罗湖区',
          location: '114.1234,22.5432',
          address: '东门',
        },
        { id: [], name: '美食', district: [], location: [], address: [] },
      ]),
    );

    const [only, ...rest] = await amapGeocoder.suggest('文和友', 'shenzhen');

    expect(rest).toEqual([]);
    expect(only.location.point).toEqual({ lon: 114.1234, lat: 22.5432, datum: 'GCJ02' });
    expect(only.location.providerRef).toEqual({ provider: 'amap', id: 'B0FFFAB6J2' });
    expect(only.location.address).toBe('深圳市罗湖区 东门');
    expect(GeocodeCache.updateOne).toHaveBeenCalled();
    expect(ProviderUsage.findOneAndUpdate).toHaveBeenCalledWith(
      { provider: 'amap', month: '2026-09' },
      { $inc: { calls: 1 } },
      expect.anything(),
    );
  });

  it('refuses at the stop line with geocode.quota, before spending a call', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    ProviderUsage.findOne.mockReturnValue(query({ calls: AMAP_SEARCH_STOP_AT }));

    await expect(amapGeocoder.suggest('文和友', 'shenzhen')).rejects.toMatchObject({
      status: 429,
      code: 'geocode.quota',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(ProviderUsage.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('turns an Amap status:0 into a named upstream error rather than an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ status: '0', infocode: '10001' }) }),
    );

    await expect(amapGeocoder.suggest('文和友', 'shenzhen')).rejects.toMatchObject({
      status: 502,
      code: 'geocode.upstream:10001',
    });
  });
});
