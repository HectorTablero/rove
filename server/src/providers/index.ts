import type { Hono } from 'hono';
import { amapGeocoder } from './amap/geocoder';
import { amapJsProxy } from './amap/jsProxy';
import type { Geocoder } from './geocoder';

/* The server's provider registry: geocoders by id, and the routes a provider needs mounted outside
   the API (the Amap JS security proxy). Core reaches providers only through here. */

export type { GeocodeCandidate, Geocoder, GeocoderUsage } from './geocoder';

export const GEOCODERS: readonly Geocoder[] = [amapGeocoder];

export function geocoderById(id: string): Geocoder {
  const geocoder = GEOCODERS.find((g) => g.id === id);
  if (!geocoder) throw new Error(`unknown geocoder "${id}"`);
  return geocoder;
}

/** Sub-apps a provider asks to have mounted at a path, with the origins the app trusts. */
export const providerRoutes = (
  trustedOrigins: readonly string[],
): { path: string; app: Hono }[] => [{ path: '/_AMapService', app: amapJsProxy(trustedOrigins) }];
