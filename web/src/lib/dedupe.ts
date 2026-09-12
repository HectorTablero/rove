import type { ItemDto, LocationDto } from '@rove/shared';
import { foldText } from '@/db/repo';

/* Whether a place about to be saved is one already saved.
 *
 * Three rules, in order of confidence, and none of them a model: the same provider POI id is the
 * same place; the same folded name within a hundred metres is the same place under a variant
 * spelling; the same canonical source URL is the same post seen twice. Embeddings were considered
 * and deferred — at personal scale these three catch what a geocoder has already normalised, and
 * the raw text is kept so a smarter pass can run over history later. */

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. Both points must be in the same datum; the caller ensures it
    by comparing items from one region, whose provider answers in one datum. */
export function distanceMetres(a: LocationDto['point'], b: LocationDto['point']): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export const NEARBY_METRES = 100;

const sameRef = (a: LocationDto | null, b: LocationDto | null): boolean =>
  !!a?.providerRef &&
  !!b?.providerRef &&
  a.providerRef.provider === b.providerRef.provider &&
  a.providerRef.id === b.providerRef.id;

const locationOf = (item: ItemDto): LocationDto | null =>
  item.kind === 'film' ? null : item.location;

export interface DuplicateQuery {
  title: string;
  location: LocationDto | null;
  canonicalUrl: string | null;
}

/** The existing item this would duplicate, or null. */
export function findDuplicate(candidate: DuplicateQuery, items: ItemDto[]): ItemDto | null {
  const title = foldText(candidate.title);
  for (const item of items) {
    if (item.status === 'dismissed') continue;
    const location = locationOf(item);
    if (sameRef(candidate.location, location)) return item;
    if (
      candidate.location &&
      location &&
      candidate.location.point.datum === location.point.datum &&
      distanceMetres(candidate.location.point, location.point) <= NEARBY_METRES &&
      [item.title, ...item.altTitles].some((t) => foldText(t) === title)
    ) {
      return item;
    }
  }
  if (candidate.canonicalUrl) {
    const url = candidate.canonicalUrl;
    return items.find((item) => item.sourceUrls.includes(url)) ?? null;
  }
  return null;
}
