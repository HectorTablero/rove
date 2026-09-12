import { describe, expect, it } from 'vitest';
import { amapNavigation } from './navigation';

const gcj = { lon: 114.0579, lat: 22.5431, datum: 'GCJ02' as const };

describe('amapNavigation', () => {
  it('builds a marker URL that opens the app, in GCJ-02, with the name', () => {
    const url = new URL(amapNavigation.markerUrl(gcj, '市民中心'));
    expect(url.origin + url.pathname).toBe('https://uri.amap.com/marker');
    expect(url.searchParams.get('position')).toBe('114.057900,22.543100');
    expect(url.searchParams.get('name')).toBe('市民中心');
    expect(url.searchParams.get('coordinate')).toBe('gaode');
    expect(url.searchParams.get('callnative')).toBe('1');
  });

  it('converts a WGS-84 point rather than sending it as if it were GCJ-02', () => {
    /* The whole reason the datum is in the type. A GPS fix sent straight to Amap lands ~500 m
       off; the conversion is what makes the marker land on the building. */
    const wgs = { lon: 114.0579, lat: 22.5431, datum: 'WGS84' as const };
    const [lon, lat] = new URL(amapNavigation.markerUrl(wgs, 'x')).searchParams
      .get('position')!
      .split(',')
      .map(Number);
    expect(lon).not.toBeCloseTo(wgs.lon, 4);
    expect(lat).not.toBeCloseTo(wgs.lat, 4);
    // In Shenzhen GCJ-02 sits a few hundred metres east-south-east of WGS-84.
    expect(Math.abs(lon - wgs.lon)).toBeLessThan(0.01);
    expect(Math.abs(lat - wgs.lat)).toBeLessThan(0.01);
  });

  it('routes to the point from wherever the user is', () => {
    const url = new URL(amapNavigation.routeUrl(gcj, '市民中心'));
    expect(url.pathname).toBe('/navigation');
    expect(url.searchParams.get('to')).toBe('114.057900,22.543100,市民中心');
    expect(url.searchParams.has('from')).toBe(false);
  });
});
