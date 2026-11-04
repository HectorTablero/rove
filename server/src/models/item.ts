import { DATUMS, ITEM_KINDS, ITEM_STATUSES } from '@rove/shared';
import { model, Schema } from 'mongoose';
import { syncedIndexes } from './synced';

/* Sub-documents are declared with `_id: false`: they are values inside the item, not rows of
   their own, and an `_id` on each would leak into the DTO and differ between a client-built and a
   server-built copy of the same location. */

const geoPointSchema = new Schema(
  {
    lon: { type: Number, required: true },
    lat: { type: Number, required: true },
    datum: { type: String, required: true, enum: DATUMS },
  },
  { _id: false },
);

const providerRefSchema = new Schema(
  {
    provider: { type: String, required: true },
    id: { type: String, required: true },
  },
  { _id: false },
);

const locationSchema = new Schema(
  {
    point: { type: geoPointSchema, required: true },
    address: { type: String, default: null },
    providerRef: { type: providerRefSchema, default: null },
  },
  { _id: false },
);

const whenSchema = new Schema(
  {
    start: { type: Date, required: true },
    end: { type: Date, default: null },
    tz: { type: String, required: true },
    allDay: { type: Boolean, default: false },
  },
  { _id: false },
);

/* One collection for every kind. The shape a kind requires is enforced by the shared zod union at
   the route, not here: Mongoose is a storage schema, and the union is the contract. `location` and
   `when` are therefore both optional at this level and the DTO mapper reads them by kind. */
const itemSchema = new Schema(
  {
    userId: { type: String, required: true },
    regionId: { type: String, required: true },
    kind: { type: String, required: true, enum: ITEM_KINDS },
    title: { type: String, required: true },
    altTitles: { type: [String], default: [] },
    categories: { type: [String], default: [] },
    status: { type: String, required: true, enum: ITEM_STATUSES, default: 'saved' },
    snapshotIds: [{ type: Schema.Types.ObjectId, ref: 'Snapshot' }],
    sourceUrls: { type: [String], default: [] },
    expiresAt: { type: Date, default: null },
    location: { type: locationSchema, default: null },
    when: { type: whenSchema, default: null },
    venue: { type: String, default: null },
    price: { type: String, default: null },
    coverUrl: { type: String, default: null },
  },
  { timestamps: true },
);

syncedIndexes(itemSchema);
/* The dedupe lookups a paste makes, both scoped to the user: "same provider POI id" first, then
   "same canonical URL" — see the ingest service. The proximity check (same normalised title within
   100 m) is a client-side pass over a user's own items, which at personal scale is a few hundred
   rows and not worth a geospatial index. */
itemSchema.index({ userId: 1, 'location.providerRef.provider': 1, 'location.providerRef.id': 1 });
itemSchema.index({ userId: 1, sourceUrls: 1 });

export const Item = model('Item', itemSchema);
