import gcoord from 'gcoord';
import type { Datum } from '../constants';
import type { GeoPoint } from '../types';

/* Derived from the function rather than imported: gcoord's ESM bundle exports the enum only as a
   property of the default export, so a named import type-checks and then fails at bundle time. */
type CRSTypes = Parameters<typeof gcoord.transform>[1];

/* The single datum conversion, wrapped so that `gcoord` is imported in exactly one file.
 *
 * Callers are the providers' navigation builders and renderers, nothing else; a test greps for the
 * import. Converting anywhere else — "just this once, to draw a marker" — is how a store ends up
 * holding coordinates in two datums with no way to tell which is which. */

const CRS: Record<Datum, CRSTypes> = {
  WGS84: gcoord.WGS84,
  GCJ02: gcoord.GCJ02,
  BD09: gcoord.BD09,
};

export function toDatum(point: GeoPoint, datum: Datum): GeoPoint {
  if (point.datum === datum) return point;
  const [lon, lat] = gcoord.transform([point.lon, point.lat], CRS[point.datum], CRS[datum]);
  return { lon, lat, datum };
}
