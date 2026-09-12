import type { GeoPoint } from '../../types';
import type { Navigation } from '../../region';
import { toDatum } from '../datum';

/* Amap's URI API: https://lbs.amap.com/api/uri-api/guide/mobile-web/point
 *
 * The universal https form rather than the `androidamap://` scheme. It works from a browser tab,
 * from the installed PWA and from the Capacitor webview alike, and `callnative=1` makes Android
 * hand it to the Amap app when it is installed and fall back to the web map when it is not. The
 * scheme form would need a package-visibility query and a fallback of its own for every caller.
 *
 * No key and no quota: these URLs are the one Amap surface that costs nothing.
 *
 * Coordinates are sent in GCJ-02 (`coordinate=gaode`), converted here if they arrived in anything
 * else. This file and the renderer are the only two places in the code base allowed to convert —
 * a test enforces it — because they are the only two that know what datum the other side wants. */

const MARKER = 'https://uri.amap.com/marker';
const NAVIGATION = 'https://uri.amap.com/navigation';
const SRC = 'rove';

const position = (point: GeoPoint): string => {
  const gcj = toDatum(point, 'GCJ02');
  // Six decimals is ~10 cm; more is noise that only lengthens the URL.
  return `${gcj.lon.toFixed(6)},${gcj.lat.toFixed(6)}`;
};

export const amapNavigation: Navigation = {
  id: 'amap',
  markerUrl(point, name) {
    const params = new URLSearchParams({
      position: position(point),
      name,
      coordinate: 'gaode',
      callnative: '1',
      src: SRC,
    });
    return `${MARKER}?${params}`;
  },
  routeUrl(point, name) {
    /* `to` is "lon,lat,name"; `from` is omitted so the app starts from the current position.
       Default mode (car) is left to the app: what Amap opens with is the user's own last choice. */
    const params = new URLSearchParams({
      to: `${position(point)},${name}`,
      coordinate: 'gaode',
      callnative: '1',
      src: SRC,
    });
    return `${NAVIGATION}?${params}`;
  },
};
