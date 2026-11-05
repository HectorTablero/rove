import type {
  ExtractionDto,
  GeoPoint,
  ImpressionDto,
  ItemDto,
  LocationDto,
  MentionDto,
  ProviderRef,
  ReviewDto,
  SnapshotDto,
  WhenDto,
} from '@rove/shared';
import type { Types } from 'mongoose';

/* Lean documents come out of mongoose with ObjectId instances and Date objects; these mappers
   normalise them into the shared DTO shapes. Every `??` is read-time tolerance for a document
   written by a build that predated a field — the alternative is a migration per added field. */

type Id = Types.ObjectId | string;
const idString = (id: Id): string => id.toString();
const iso = (date: Date | string): string =>
  date instanceof Date ? date.toISOString() : new Date(date).toISOString();

interface LeanLocation {
  point: GeoPoint;
  address?: string | null;
  providerRef?: ProviderRef | null;
}

interface LeanWhen {
  start: Date;
  end?: Date | null;
  tz: string;
  allDay?: boolean;
}

export interface LeanItem {
  _id: Types.ObjectId;
  regionId: string;
  kind: ItemDto['kind'];
  title: string;
  altTitles?: string[];
  categories?: string[];
  status: ItemDto['status'];
  snapshotIds?: Id[];
  sourceUrls?: string[];
  expiresAt?: Date | null;
  location?: LeanLocation | null;
  when?: LeanWhen | null;
  venue?: string | null;
  price?: string | null;
  coverUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const locationToDto = (location: LeanLocation): LocationDto => ({
  point: { lon: location.point.lon, lat: location.point.lat, datum: location.point.datum },
  address: location.address ?? null,
  providerRef: location.providerRef
    ? { provider: location.providerRef.provider, id: location.providerRef.id }
    : null,
});

const whenToDto = (when: LeanWhen): WhenDto => ({
  start: iso(when.start),
  end: when.end ? iso(when.end) : null,
  tz: when.tz,
  allDay: when.allDay ?? false,
});

/**
 * Item → DTO, by kind.
 *
 * The union is rebuilt branch by branch rather than spread from the lean row, so that a place
 * stored with a stray `when` (or a film with a `location`) comes out as the DTO its kind promises.
 * Storage is permissive; the wire shape is not.
 */
export const itemToDto = (item: LeanItem): ItemDto => {
  const base = {
    id: idString(item._id),
    regionId: item.regionId,
    title: item.title,
    altTitles: item.altTitles ?? [],
    categories: item.categories ?? [],
    status: item.status,
    snapshotIds: (item.snapshotIds ?? []).map(idString),
    sourceUrls: item.sourceUrls ?? [],
    expiresAt: item.expiresAt ? iso(item.expiresAt) : null,
    price: item.price ?? null,
    coverUrl: item.coverUrl ?? null,
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt),
  };
  switch (item.kind) {
    case 'place':
      /* A place without a location cannot be built, and one cannot be stored either — the route
         validates the union before the model sees it. The throw is for a row edited by hand. */
      if (!item.location) throw new Error(`item ${base.id}: a place must have a location`);
      return { ...base, kind: 'place', location: locationToDto(item.location) };
    case 'event':
      return {
        ...base,
        kind: 'event',
        location: item.location ? locationToDto(item.location) : null,
        when: item.when ? whenToDto(item.when) : null,
        venue: item.venue ?? null,
      };
    case 'film':
      return { ...base, kind: 'film', when: item.when ? whenToDto(item.when) : null };
  }
};

interface LeanExtraction {
  model: string;
  at: Date;
  mentions?: MentionDto[];
}

export interface LeanSnapshot {
  _id: Types.ObjectId;
  sourceId: string;
  url: string;
  canonicalUrl?: string | null;
  fetchedAt: Date;
  contentType?: string;
  body?: string;
  text?: string;
  error?: string | null;
  extraction?: LeanExtraction | null;
  createdAt: Date;
  updatedAt: Date;
}

const extractionToDto = (extraction: LeanExtraction): ExtractionDto => ({
  model: extraction.model,
  at: iso(extraction.at),
  mentions: (extraction.mentions ?? []).map((m) => ({
    nameText: m.nameText,
    addressText: m.addressText ?? null,
    searchText: m.searchText ?? null,
    ...(m.aliases?.length ? { aliases: m.aliases } : {}),
    evidence: m.evidence,
  })),
});

export const snapshotToDto = (snapshot: LeanSnapshot): SnapshotDto => ({
  id: idString(snapshot._id),
  sourceId: snapshot.sourceId,
  url: snapshot.url,
  canonicalUrl: snapshot.canonicalUrl ?? null,
  fetchedAt: iso(snapshot.fetchedAt),
  contentType: snapshot.contentType ?? '',
  body: snapshot.body ?? '',
  text: snapshot.text ?? '',
  error: snapshot.error ?? null,
  extraction: snapshot.extraction ? extractionToDto(snapshot.extraction) : null,
  createdAt: iso(snapshot.createdAt),
  updatedAt: iso(snapshot.updatedAt),
});

export interface LeanReview {
  _id: Types.ObjectId;
  itemId: Id;
  rating?: number | null;
  notes?: string;
  visits?: Date[];
  createdAt: Date;
  updatedAt: Date;
}

export const reviewToDto = (review: LeanReview): ReviewDto => ({
  id: idString(review._id),
  itemId: idString(review.itemId),
  rating: review.rating ?? null,
  notes: review.notes ?? '',
  visits: (review.visits ?? []).map(iso),
  createdAt: iso(review.createdAt),
  updatedAt: iso(review.updatedAt),
});

export interface LeanImpression {
  _id: Types.ObjectId;
  itemId: Id;
  surface: ImpressionDto['surface'];
  at: Date;
  action?: ImpressionDto['action'];
  createdAt: Date;
  updatedAt: Date;
}

export const impressionToDto = (impression: LeanImpression): ImpressionDto => ({
  id: idString(impression._id),
  itemId: idString(impression.itemId),
  surface: impression.surface,
  at: iso(impression.at),
  action: impression.action ?? null,
  createdAt: iso(impression.createdAt),
  updatedAt: iso(impression.updatedAt),
});
