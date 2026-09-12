import type { Datum, ItemKind } from './constants';
import type { GeoPoint } from './types';

/* The region boundary.
 *
 * A region is a declared bundle: which coordinate datum its providers speak, who geocodes, who
 * navigates, who draws the map, and which sources feed it. Core code reads the bundle through the
 * registry in ./regions and never names a provider. Shenzhen is the only region that exists, and
 * the abstraction is deliberately as thin as one implementation allows — a second region is
 * additive, not a refactor.
 *
 * Three interfaces, because three different things are being asked for:
 *   - a `Navigation` builds a URL that hands a point to a maps app (pure; lives in shared)
 *   - a `Geocoder` turns a query into candidates (needs a key; lives in the server)
 *   - a `MapRenderer` draws points on tiles (needs a DOM; lives in the web app)
 * A provider may implement all three (Amap does) but nothing forces it to, and nothing lets one
 * leak into another: a POI id from the geocoder reaches navigation only as an opaque
 * `ProviderRef`, and coordinates cross every one of them tagged with their datum. */

export interface RegionDescriptor {
  /** Lowercase slug, the value stored on every item as `regionId`. */
  id: string;
  /** Display name, in the region's own language. */
  name: string;
  /** IANA zone every time window in this region is meant in. */
  tz: string;
  locale: string;
  currency: string;
  /** The datum the region's providers produce and expect. */
  datum: Datum;
  /** Where the map opens before there is a location fix. */
  center: GeoPoint;
  /** Ids into the provider registries: each is a key, never an import. */
  navigation: string;
  geocoder: string;
  renderer: string;
  /** The sources whose `regionIds` include this one, resolved by the source registry. */
  sources: string[];
  /**
   * Per-source parameters this region needs — the Douban location id, the Showstart city code,
   * the Damai city name. Strings, keyed by source id then parameter, so a poller reads
   * `region.sourceParams[source.id].locationId` and a missing one is a loud "not configured"
   * rather than a feed for the wrong city.
   */
  sourceParams: Record<string, Record<string, string>>;
}

/**
 * A maps-app hand-off. Pure URL building; the only place besides a renderer that may convert
 * between datums, because it is the only place that knows which datum the target app wants.
 */
export interface Navigation {
  id: string;
  /** Show one point, named, in the maps app. */
  markerUrl(point: GeoPoint, name: string): string;
  /** Route from the user's current position to the point. */
  routeUrl(point: GeoPoint, name: string): string;
}

/** How much a source costs to run, shown in the UI so the trade-off is never hidden. */
export type SourceTier =
  /** Official or otherwise clean API. */
  | 'A'
  /** Unauthenticated public page; no account at stake, only an IP. */
  | 'B'
  /** Needs a logged-in cookie; the account behind it is at risk. */
  | 'C'
  /** Manual only: the user shares into the app. */
  | 'M';

/**
 * What every source declares, outside any code that fetches.
 *
 * The manifest is the registry's whole knowledge of a source: enough to route a pasted URL to the
 * right resolver and to tell the user what kind of source it is, without loading the resolver.
 * The resolver itself lives in the server and is looked up by `id`.
 */
export interface SourceManifest {
  id: string;
  /** Human name, untranslated: it is the name of a service. */
  name: string;
  /** `'*'` for a source that works anywhere (a generic Open Graph page), else region ids. */
  regionIds: string[] | '*';
  kinds: ItemKind[];
  tier: SourceTier;
  /** Whether a pasted URL belongs to this source. Pure, and cheap enough to run on every keystroke. */
  matches(url: URL): boolean;
  /** Whether the server can poll this source on a schedule, or only resolve shared URLs. */
  polls: boolean;
  /** The region parameters a poller needs, by name, so the registry can say which are missing. */
  params?: string[];
}
