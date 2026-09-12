import {
  impressionCreateSchema,
  impressionUpdateSchema,
  itemCreateSchema,
  itemUpdateSchema,
  reviewCreateSchema,
  reviewUpdateSchema,
  snapshotCreateSchema,
  snapshotUpdateSchema,
} from '@rove/shared';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { impressionToDto, itemToDto, reviewToDto, snapshotToDto } from '../dto';
import { Impression } from '../models/impression';
import { Item } from '../models/item';
import { Review } from '../models/review';
import { Snapshot } from '../models/snapshot';
import { syncedCollectionRouter } from './synced';

/* The four synced collections, each one call to the factory.
 *
 * `toStored` exists because the wire carries ISO strings and the models store Dates. Mongoose casts
 * a top-level `Date` field from a string on its own; it does not reach into a `$set` of a whole
 * nested object (`when`, `extraction`), so those are converted here. Everything else passes
 * through untouched. */

const date = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

type WhenInput = { start: string; end: string | null; tz: string; allDay: boolean } | null;
type ExtractionInput = { model: string; at: string; mentions: unknown[] } | null;

const storedWhen = (when: WhenInput | undefined) =>
  when === undefined
    ? {}
    : { when: when ? { ...when, start: date(when.start), end: date(when.end) } : null };

const storedExtraction = (extraction: ExtractionInput | undefined) =>
  extraction === undefined
    ? {}
    : { extraction: extraction ? { ...extraction, at: date(extraction.at) } : null };

export const itemsRouter = syncedCollectionRouter({
  coll: 'item',
  model: Item as unknown as Model<unknown>,
  createSchema: itemCreateSchema,
  updateSchema: itemUpdateSchema,
  toDto: itemToDto,
  code: 'item',
  toStored: (input) => {
    const { when, snapshotIds, expiresAt, ...rest } = input as Record<string, unknown> & {
      when?: WhenInput;
      snapshotIds?: string[];
      expiresAt?: string | null;
    };
    return {
      ...rest,
      ...storedWhen(when),
      ...(snapshotIds ? { snapshotIds: snapshotIds.map((id) => new Types.ObjectId(id)) } : {}),
      ...(expiresAt !== undefined ? { expiresAt: date(expiresAt) } : {}),
    };
  },
});

export const snapshotsRouter = syncedCollectionRouter({
  coll: 'snapshot',
  model: Snapshot as unknown as Model<unknown>,
  createSchema: snapshotCreateSchema,
  updateSchema: snapshotUpdateSchema,
  toDto: snapshotToDto,
  code: 'snapshot',
  toStored: (input) => {
    const { extraction, ...rest } = input as Record<string, unknown> & {
      extraction?: ExtractionInput;
    };
    return { ...rest, ...storedExtraction(extraction) };
  },
});

export const reviewsRouter = syncedCollectionRouter({
  coll: 'review',
  model: Review as unknown as Model<unknown>,
  createSchema: reviewCreateSchema,
  updateSchema: reviewUpdateSchema,
  toDto: reviewToDto,
  code: 'review',
  toStored: (input) => {
    const { itemId, visits, ...rest } = input as Record<string, unknown> & {
      itemId?: string;
      visits?: string[];
    };
    return {
      ...rest,
      ...(itemId ? { itemId: new Types.ObjectId(itemId) } : {}),
      ...(visits ? { visits: visits.map((v) => new Date(v)) } : {}),
    };
  },
});

export const impressionsRouter = syncedCollectionRouter({
  coll: 'impression',
  model: Impression as unknown as Model<unknown>,
  createSchema: impressionCreateSchema,
  updateSchema: impressionUpdateSchema,
  toDto: impressionToDto,
  code: 'impression',
  toStored: (input) => {
    const { itemId, ...rest } = input as Record<string, unknown> & { itemId?: string };
    return { ...rest, ...(itemId ? { itemId: new Types.ObjectId(itemId) } : {}) };
  },
});
