import type { Datum, ImpressionAction, ImpressionSurface, ItemStatus } from './constants';

/* The wire shapes. Every DTO is what the server sends and what the client mirrors into Dexie: there
   is no second, "local" shape to keep in step (the app this grew from needed one because rows joined to people
   at read time; nothing here references anything else by name). */

/**
 * A coordinate that knows what it is a coordinate *in*.
 *
 * `datum` is not optional and has no default. Amap answers in GCJ-02, a phone's GPS in WGS-84, and
 * Baidu in BD-09; a point stored without saying which is a point that will be drawn 500 m off on
 * the day someone changes the map. Conversions live in `providers/`, never in core.
 */
export interface GeoPoint {
  lon: number;
  lat: number;
  datum: Datum;
}

/**
 * A provider's own identifier for something — an Amap POI id, say.
 *
 * Opaque to core: `provider` names who can interpret `id`, and only that provider's geocoder and
 * navigation builder ever read it. It exists so a place can be re-looked-up and deep-linked by id
 * rather than by coordinates, and so two mentions of one restaurant collapse on it.
 */
export interface ProviderRef {
  provider: string;
  id: string;
}

export interface LocationDto {
  point: GeoPoint;
  address: string | null;
  providerRef: ProviderRef | null;
}

/** A time window. `end` null means "no end known" for an event, and single-day for `allDay`. */
export interface WhenDto {
  start: string;
  end: string | null;
  /** IANA zone the times are meant in — an event is local to where it happens. */
  tz: string;
  allDay: boolean;
}

interface ItemBaseDto {
  id: string;
  regionId: string;
  title: string;
  /** Other names the same thing is known by: the Chinese name, the English name, a nickname. */
  altTitles: string[];
  /** Free tags such as `restaurant`, `cafe`, `hike`. Not an enum: the sources decide. */
  categories: string[];
  status: ItemStatus;
  /** Every snapshot this item was built from, newest last. Merging a duplicate appends here. */
  snapshotIds: string[];
  /** Every URL this item was seen at, de-duplicated. */
  sourceUrls: string[];
  /** The price as the source printed it (`¥80-180`, `免费`). Text, never parsed into a number. */
  price: string | null;
  /** A poster or cover image URL from the source. Never proxied; the browser loads it directly. */
  coverUrl: string | null;
  /** When the item stops being worth showing. Null for a place. */
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaceItemDto extends ItemBaseDto {
  kind: 'place';
  location: LocationDto;
}

export interface EventItemDto extends ItemBaseDto {
  kind: 'event';
  location: LocationDto | null;
  /** Null means the time is genuinely unknown — shown as "time unknown", never invented. */
  when: WhenDto | null;
  /** The venue as the source wrote it, before (or instead of) a geocode. */
  venue: string | null;
}

export interface FilmItemDto extends ItemBaseDto {
  kind: 'film';
  when: WhenDto | null;
}

export type ItemDto = PlaceItemDto | EventItemDto | FilmItemDto;

/**
 * A candidate the extractor found in a snapshot's text.
 *
 * `evidence` must be a verbatim substring of `SnapshotDto.text` — validated in code, not asked of
 * the model — which is what makes "the LLM never originates a fact" a structural property: a
 * mention whose evidence is not in the source is dropped before anyone sees it.
 */
export interface MentionDto {
  nameText: string;
  /** The location's parts, largest area first, space-separated; each quoted from the post. */
  addressText: string | null;
  /** The map-search query that finds this branch: name plus location parts, each quoted. */
  searchText: string | null;
  /** The post's other names for the same place — a translation, a romanisation, a shorter or
      longer form — each quoted. Absent on extractions from before it existed. */
  aliases?: string[];
  evidence: string;
}

export interface ExtractionDto {
  model: string;
  at: string;
  mentions: MentionDto[];
}

/** What a source produced for one URL, kept raw so extraction can be re-run without re-fetching. */
export interface SnapshotDto {
  id: string;
  /** The `Source` that produced it — `instagram-oembed`, `xiaohongshu-share`, `generic-og`. */
  sourceId: string;
  url: string;
  /** The URL after redirects and tracking-parameter stripping, or null if the fetch never got there. */
  canonicalUrl: string | null;
  fetchedAt: string;
  contentType: string;
  /** The raw payload, scripts stripped. Empty when the fetch failed; `error` says why. */
  body: string;
  /** The caption / description as the resolver read it. */
  text: string;
  /** Why the resolve failed, or null. Loud rather than a blank: the URL stays as a bare item. */
  error: string | null;
  extraction: ExtractionDto | null;
  createdAt: string;
  updatedAt: string;
}

/** The user's own judgement of an item. Private, and the only irreplaceable rows. */
export interface ReviewDto {
  id: string;
  itemId: string;
  rating: number | null;
  notes: string;
  /** ISO dates of visits, oldest first. */
  visits: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ImpressionDto {
  id: string;
  itemId: string;
  surface: ImpressionSurface;
  at: string;
  action: ImpressionAction | null;
  createdAt: string;
  updatedAt: string;
}

export interface SettingsDto {
  regionId: string;
  quietNotifications: boolean;
  llmBaseUrl: string;
  llmModel: string;
  /* The key is write-only: it goes up through SettingsInput and is never sent back down. Only
     *whether* one is stored crosses the wire, so it is not in the settings response, not in the
     IndexedDB mirror, and not in a backup file. */
  hasLlmKey: boolean;
  pollSources: string[];
}

// --- Sync ---

export type SyncCollection = 'item' | 'snapshot' | 'review' | 'impression';

export interface SyncDeletion {
  coll: SyncCollection;
  docId: string;
  deletedAt: string;
}

export interface SyncResponse {
  serverTime: string;
  /**
   * True when this is the complete state rather than a delta.
   *
   * The server answers a first sync and any cursor older than the tombstone window this way: a
   * delta could not describe what such a client missed. The client treats every local id the
   * response does not name as deleted — which is safe precisely because it only happens here.
   */
  reset: boolean;
  items: ItemDto[];
  snapshots: SnapshotDto[];
  reviews: ReviewDto[];
  impressions: ImpressionDto[];
  settings: SettingsDto;
  deletions: SyncDeletion[];
}
