import type { LocationDto } from '@rove/shared';

/* The geocoder interface: a query in, candidates out, and a running total of what it cost.
 *
 * Deliberately narrow. There is no "look up by POI id" and no "reverse geocode" because nothing
 * needs them yet, and every method here is one more thing a second provider has to fake. A
 * candidate carries the provider's own id inside an opaque `providerRef` — core never reads it —
 * and a point tagged with the provider's datum, which is the whole point of the tag. */

export interface GeocodeCandidate {
  /** The provider's display name for the place — what the item's title defaults to. */
  name: string;
  /** A district or neighbourhood, for telling two 星巴克 apart in the picker. */
  district: string | null;
  location: LocationDto;
}

export interface GeocoderUsage {
  /** Calendar month the counter is for, `YYYY-MM`, in the server's clock. */
  month: string;
  /** Calls made this month that count against the provider's pool. */
  calls: number;
  /** The free pool per month. */
  limit: number;
  /** Where the app stops on its own, short of the limit, so a bug cannot spend the whole pool. */
  stopAt: number;
}

export interface Geocoder {
  id: string;
  /** Whether the server has what it needs to call this provider (a key, typically). */
  configured(): boolean;
  /**
   * Candidates for a free-text query near the region's centre. Answers from cache when it can
   * and refuses — `geocode.quota` — rather than exceed `stopAt`.
   */
  suggest(query: string, regionId: string): Promise<GeocodeCandidate[]>;
  usage(): Promise<GeocoderUsage>;
}
