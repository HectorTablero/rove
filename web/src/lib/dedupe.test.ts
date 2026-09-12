import type { ItemDto } from '@rove/shared';
import { describe, expect, it } from 'vitest';
import { distanceMetres, findDuplicate } from './dedupe';

const place = (
  patch: Partial<ItemDto> & { id: string; title: string },
  lon = 114.05,
  lat = 22.54,
): ItemDto =>
  ({
    regionId: 'shenzhen',
    kind: 'place',
    altTitles: [],
    categories: [],
    status: 'saved',
    snapshotIds: [],
    sourceUrls: [],
    expiresAt: null,
    location: { point: { lon, lat, datum: 'GCJ02' }, address: null, providerRef: null },
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...patch,
  }) as ItemDto;

describe('distanceMetres', () => {
  it('measures a known Shenzhen hop', () => {
    // 市民中心 to 深圳会展中心 is a little over a kilometre.
    const d = distanceMetres(
      { lon: 114.0579, lat: 22.5431, datum: 'GCJ02' },
      { lon: 114.0637, lat: 22.5343, datum: 'GCJ02' },
    );
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1300);
  });
});

describe('findDuplicate', () => {
  it('matches on the provider POI id before anything else', () => {
    const existing = place({
      id: 'a',
      title: 'Wenheyou',
      location: {
        point: { lon: 114.1, lat: 22.5, datum: 'GCJ02' },
        address: null,
        providerRef: { provider: 'amap', id: 'B1' },
      },
    });
    const hit = findDuplicate(
      {
        title: '文和友',
        location: {
          point: { lon: 114.9, lat: 22.9, datum: 'GCJ02' },
          address: null,
          providerRef: { provider: 'amap', id: 'B1' },
        },
        canonicalUrl: null,
      },
      [existing],
    );
    expect(hit?.id).toBe('a');
  });

  it('matches the same folded name within 100 m, including an alt title', () => {
    const existing = place(
      { id: 'a', title: 'Bionic Brew', altTitles: ['拜恩精酿'] },
      114.05,
      22.54,
    );
    const near = {
      point: { lon: 114.0505, lat: 22.5403, datum: 'GCJ02' as const },
      address: null,
      providerRef: null,
    };
    expect(
      findDuplicate({ title: 'bionic  brew', location: near, canonicalUrl: null }, [existing])?.id,
    ).toBe('a');
    expect(
      findDuplicate({ title: '拜恩精酿', location: near, canonicalUrl: null }, [existing])?.id,
    ).toBe('a');
  });

  it('does not match the same name 2 km away — a chain has branches', () => {
    const existing = place({ id: 'a', title: '星巴克' }, 114.05, 22.54);
    const far = {
      point: { lon: 114.07, lat: 22.54, datum: 'GCJ02' as const },
      address: null,
      providerRef: null,
    };
    expect(
      findDuplicate({ title: '星巴克', location: far, canonicalUrl: null }, [existing]),
    ).toBeNull();
  });

  it('never compares points in different datums', () => {
    const existing = place({ id: 'a', title: 'x' }, 114.05, 22.54);
    const wgs = {
      point: { lon: 114.05, lat: 22.54, datum: 'WGS84' as const },
      address: null,
      providerRef: null,
    };
    expect(findDuplicate({ title: 'x', location: wgs, canonicalUrl: null }, [existing])).toBeNull();
  });

  it('falls back to the canonical URL, and ignores dismissed items', () => {
    const existing = place(
      { id: 'a', title: 'x', sourceUrls: ['https://www.instagram.com/p/C1/'] },
      114.05,
      22.54,
    );
    expect(
      findDuplicate(
        { title: 'y', location: null, canonicalUrl: 'https://www.instagram.com/p/C1/' },
        [existing],
      )?.id,
    ).toBe('a');
    const dismissed = { ...existing, status: 'dismissed' as const };
    expect(
      findDuplicate(
        {
          title: 'x',
          location: existing.kind === 'place' ? existing.location : null,
          canonicalUrl: null,
        },
        [dismissed],
      ),
    ).toBeNull();
  });
});
