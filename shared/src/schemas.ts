import { z } from 'zod';
import {
  DATUMS,
  IMPRESSION_ACTIONS,
  IMPRESSION_SURFACES,
  ITEM_STATUSES,
  MAX_ADDRESS_LENGTH,
  MAX_ALT_TITLES,
  MAX_CATEGORIES,
  MAX_CATEGORY_LENGTH,
  MAX_LLM_BASE_URL_LENGTH,
  MAX_LLM_KEY_LENGTH,
  MAX_LLM_MODEL_LENGTH,
  MAX_MENTION_LENGTH,
  MAX_MENTIONS_PER_SNAPSHOT,
  MAX_NOTES_LENGTH,
  MAX_POLL_SOURCES,
  MAX_VENUE_LENGTH,
  MAX_PROVIDER_ID_LENGTH,
  MAX_SNAPSHOT_BODY_BYTES,
  MAX_SNAPSHOT_TEXT_LENGTH,
  MAX_SNAPSHOTS_PER_ITEM,
  MAX_SOURCE_URLS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  MAX_VISITS,
  OBJECT_ID_REGEX,
  RATING_MAX,
  RATING_MIN,
  REGION_ID_REGEX,
  SOURCE_ID_REGEX,
} from './constants';

export const objectIdSchema = z.string().regex(OBJECT_ID_REGEX, 'invalid id');
export const isoDateTimeSchema = z.iso.datetime();
export const regionIdSchema = z.string().regex(REGION_ID_REGEX, 'expected a region id');
export const sourceIdSchema = z.string().regex(SOURCE_ID_REGEX, 'expected a source id');
export const urlSchema = z.string().trim().url().max(MAX_URL_LENGTH);

// --- Geography ---

/* Longitude first, matching GeoJSON and every provider this app talks to. Bounds are the datum's
   nominal ones; a point outside them is a swapped pair, which is the second most common way to be
   500 m off after mixing datums. */
export const geoPointSchema = z.object({
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  datum: z.enum(DATUMS),
});

export const providerRefSchema = z.object({
  provider: z.string().trim().min(1).max(40),
  id: z.string().trim().min(1).max(MAX_PROVIDER_ID_LENGTH),
});

export const locationSchema = z.object({
  point: geoPointSchema,
  address: z.string().trim().max(MAX_ADDRESS_LENGTH).nullable().default(null),
  providerRef: providerRefSchema.nullable().default(null),
});

export const whenSchema = z
  .object({
    start: isoDateTimeSchema,
    end: isoDateTimeSchema.nullable().default(null),
    tz: z.string().trim().min(1).max(64),
    allDay: z.boolean().default(false),
  })
  .refine((when) => when.end === null || when.end >= when.start, {
    message: 'end must not precede start',
    path: ['end'],
  });

// --- Items ---

const titleSchema = z.string().trim().min(1).max(MAX_TITLE_LENGTH);
const altTitlesSchema = z.array(titleSchema).max(MAX_ALT_TITLES);
const categoriesSchema = z
  .array(z.string().trim().min(1).max(MAX_CATEGORY_LENGTH))
  .max(MAX_CATEGORIES);
const snapshotIdsSchema = z.array(objectIdSchema).max(MAX_SNAPSHOTS_PER_ITEM);
const sourceUrlsSchema = z.array(urlSchema).max(MAX_SOURCE_URLS);

/* Shared by the three kinds. `id` and `createdAt` are client-generated so an offline create keeps
   its identity and order when it syncs later. */
const itemBaseCreate = {
  id: objectIdSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  regionId: regionIdSchema,
  title: titleSchema,
  altTitles: altTitlesSchema.default([]),
  categories: categoriesSchema.default([]),
  status: z.enum(ITEM_STATUSES).default('saved'),
  snapshotIds: snapshotIdsSchema.default([]),
  sourceUrls: sourceUrlsSchema.default([]),
  expiresAt: isoDateTimeSchema.nullable().default(null),
};

/**
 * One schema per kind, discriminated on `kind`, so the shape each kind requires is enforced at the
 * edge: a place must have a location, a film must not. Adding a kind is one more member here and
 * one more branch wherever the union is rendered — the compiler lists them.
 */
export const itemCreateSchema = z.discriminatedUnion('kind', [
  z.object({ ...itemBaseCreate, kind: z.literal('place'), location: locationSchema }),
  z.object({
    ...itemBaseCreate,
    kind: z.literal('event'),
    location: locationSchema.nullable().default(null),
    when: whenSchema.nullable().default(null),
    venue: z.string().trim().max(MAX_VENUE_LENGTH).nullable().default(null),
  }),
  z.object({
    ...itemBaseCreate,
    kind: z.literal('film'),
    when: whenSchema.nullable().default(null),
  }),
]);

/* Every field optional and never defaulted: a PATCH queued by an older client must not blank a
   field it never knew about on replay. `kind` and `regionId` are absent on purpose — they are the
   row's identity, not its contents. Changing either means a new item. */
export const itemUpdateSchema = z.object({
  title: titleSchema.optional(),
  altTitles: altTitlesSchema.optional(),
  categories: categoriesSchema.optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  snapshotIds: snapshotIdsSchema.optional(),
  sourceUrls: sourceUrlsSchema.optional(),
  expiresAt: isoDateTimeSchema.nullable().optional(),
  location: locationSchema.nullable().optional(),
  when: whenSchema.nullable().optional(),
  venue: z.string().trim().max(MAX_VENUE_LENGTH).nullable().optional(),
});

// --- Snapshots ---

/* One encoder, reused. `length` is UTF-16 code units and the cap is bytes: for Chinese text the two
   differ by a factor of three, so measuring the wrong one would let a page three times the cap in. */
const encoder = new TextEncoder();

export const snapshotBodySchema = z
  .string()
  .refine((body) => encoder.encode(body).length <= MAX_SNAPSHOT_BODY_BYTES, {
    message: `body: larger than ${MAX_SNAPSHOT_BODY_BYTES} bytes`,
  });

export const mentionSchema = z.object({
  nameText: z.string().trim().min(1).max(MAX_MENTION_LENGTH),
  addressText: z.string().trim().max(MAX_ADDRESS_LENGTH).nullable().default(null),
  evidence: z.string().min(1).max(MAX_SNAPSHOT_TEXT_LENGTH),
});

export const extractionSchema = z.object({
  model: z.string().trim().min(1).max(100),
  at: isoDateTimeSchema,
  mentions: z.array(mentionSchema).max(MAX_MENTIONS_PER_SNAPSHOT),
});

export const snapshotCreateSchema = z.object({
  id: objectIdSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  sourceId: sourceIdSchema,
  url: urlSchema,
  canonicalUrl: urlSchema.nullable().default(null),
  fetchedAt: isoDateTimeSchema,
  contentType: z.string().trim().max(100).default(''),
  body: snapshotBodySchema.default(''),
  text: z.string().max(MAX_SNAPSHOT_TEXT_LENGTH).default(''),
  error: z.string().trim().max(500).nullable().default(null),
  extraction: extractionSchema.nullable().default(null),
});

/* `sourceId` and `url` are what the row *is*; the rest is what a re-resolve or a re-extract writes. */
export const snapshotUpdateSchema = z.object({
  canonicalUrl: urlSchema.nullable().optional(),
  fetchedAt: isoDateTimeSchema.optional(),
  contentType: z.string().trim().max(100).optional(),
  body: snapshotBodySchema.optional(),
  text: z.string().max(MAX_SNAPSHOT_TEXT_LENGTH).optional(),
  error: z.string().trim().max(500).nullable().optional(),
  extraction: extractionSchema.nullable().optional(),
});

// --- Reviews ---

const ratingSchema = z.number().int().min(RATING_MIN).max(RATING_MAX).nullable();
const visitsSchema = z.array(isoDateTimeSchema).max(MAX_VISITS);

export const reviewCreateSchema = z.object({
  id: objectIdSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  itemId: objectIdSchema,
  rating: ratingSchema.default(null),
  notes: z.string().max(MAX_NOTES_LENGTH).default(''),
  visits: visitsSchema.default([]),
});

export const reviewUpdateSchema = z.object({
  rating: ratingSchema.optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
  visits: visitsSchema.optional(),
});

// --- Impressions ---

export const impressionCreateSchema = z.object({
  id: objectIdSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  itemId: objectIdSchema,
  surface: z.enum(IMPRESSION_SURFACES),
  at: isoDateTimeSchema,
  action: z.enum(IMPRESSION_ACTIONS).nullable().default(null),
});

/** The only thing that changes on an impression is what the user went on to do. */
export const impressionUpdateSchema = z.object({
  action: z.enum(IMPRESSION_ACTIONS).nullable().optional(),
});

// --- Settings ---

export const settingsSchema = z.object({
  regionId: regionIdSchema,
  quietNotifications: z.boolean(),
  /* Empty means "not configured": the extract step then reports that rather than calling nowhere.
     Trimmed, and a trailing slash dropped so `${base}/chat/completions` is never `//`. */
  llmBaseUrl: z
    .string()
    .trim()
    .max(MAX_LLM_BASE_URL_LENGTH)
    .transform((url) => url.replace(/\/+$/, '')),
  llmModel: z.string().trim().max(MAX_LLM_MODEL_LENGTH),
  /** Optional so a replayed offline payload from a save that never touched the key cannot blank it.
      An empty string is an explicit removal. */
  llmApiKey: z.string().trim().max(MAX_LLM_KEY_LENGTH).optional(),
  pollSources: z.array(sourceIdSchema).max(MAX_POLL_SOURCES).default([]),
});

// --- Sync ---

export const syncQuerySchema = z.object({
  since: isoDateTimeSchema.optional(),
});

export type ItemCreateInput = z.infer<typeof itemCreateSchema>;
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;
export type SnapshotCreateInput = z.infer<typeof snapshotCreateSchema>;
export type SnapshotUpdateInput = z.infer<typeof snapshotUpdateSchema>;
export type ReviewCreateInput = z.infer<typeof reviewCreateSchema>;
export type ReviewUpdateInput = z.infer<typeof reviewUpdateSchema>;
export type ImpressionCreateInput = z.infer<typeof impressionCreateSchema>;
export type ImpressionUpdateInput = z.infer<typeof impressionUpdateSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
