import type { ImpressionDto, ItemDto, ReviewDto, SnapshotDto } from '@rove/shared';
import {
  impressionCreateSchema,
  itemCreateSchema,
  reviewCreateSchema,
  snapshotCreateSchema,
} from '@rove/shared';
import { db, type OutboxOp } from '@/db/db';
import { enqueueBatch } from '@/db/outbox';
import { backupEnvelopeSchema } from './backup';

/* Restoring a backup: every row re-validated by the shared create schema, written to the local
   store, and queued for the server as an ordinary create — the same path a paste takes, so there
   is only one way a row has ever reached the server. Rows whose id is already here are skipped;
   the file is a snapshot of the past and the store is the present. `tolerate404` marks the ops
   so a create the server refuses because its parent is long gone is not reported as a lost write. */

export interface ImportSummary {
  items: number;
  snapshots: number;
  reviews: number;
  impressions: number;
  skipped: number;
  invalid: number;
}

const stripServerFields = <T extends { updatedAt?: string }>(row: T): Omit<T, 'updatedAt'> => {
  const { updatedAt: _updatedAt, ...rest } = row;
  return rest;
};

export async function importBackup(json: string): Promise<ImportSummary> {
  const envelope = backupEnvelopeSchema.parse(JSON.parse(json));
  const summary: ImportSummary = {
    items: 0,
    snapshots: 0,
    reviews: 0,
    impressions: 0,
    skipped: 0,
    invalid: 0,
  };
  const ops: OutboxOp[] = [];

  const existing = {
    items: new Set(await db.items.toCollection().primaryKeys()),
    snapshots: new Set(await db.snapshots.toCollection().primaryKeys()),
    reviews: new Set(await db.reviews.toCollection().primaryKeys()),
    impressions: new Set(await db.impressions.toCollection().primaryKeys()),
  };

  const snapshots: SnapshotDto[] = [];
  for (const raw of envelope.snapshots) {
    const parsed = snapshotCreateSchema.safeParse(stripServerFields(raw as SnapshotDto));
    if (!parsed.success || !parsed.data.id) {
      summary.invalid++;
      continue;
    }
    if (existing.snapshots.has(parsed.data.id)) {
      summary.skipped++;
      continue;
    }
    const row = raw as SnapshotDto;
    snapshots.push(row);
    ops.push({ method: 'POST', path: '/snapshots', body: parsed.data, tolerate404: true });
  }

  const items: ItemDto[] = [];
  for (const raw of envelope.items) {
    const parsed = itemCreateSchema.safeParse(stripServerFields(raw as ItemDto));
    if (!parsed.success || !parsed.data.id) {
      summary.invalid++;
      continue;
    }
    if (existing.items.has(parsed.data.id)) {
      summary.skipped++;
      continue;
    }
    items.push(raw as ItemDto);
    ops.push({ method: 'POST', path: '/items', body: parsed.data, tolerate404: true });
  }

  const reviews: ReviewDto[] = [];
  for (const raw of envelope.reviews) {
    const parsed = reviewCreateSchema.safeParse(stripServerFields(raw as ReviewDto));
    if (!parsed.success || !parsed.data.id) {
      summary.invalid++;
      continue;
    }
    if (existing.reviews.has(parsed.data.id)) {
      summary.skipped++;
      continue;
    }
    reviews.push(raw as ReviewDto);
    ops.push({ method: 'POST', path: '/reviews', body: parsed.data, tolerate404: true });
  }

  const impressions: ImpressionDto[] = [];
  for (const raw of envelope.impressions) {
    const parsed = impressionCreateSchema.safeParse(stripServerFields(raw as ImpressionDto));
    if (!parsed.success || !parsed.data.id) {
      summary.invalid++;
      continue;
    }
    if (existing.impressions.has(parsed.data.id)) {
      summary.skipped++;
      continue;
    }
    impressions.push(raw as ImpressionDto);
    ops.push({ method: 'POST', path: '/impressions', body: parsed.data, tolerate404: true });
  }

  await db.transaction('rw', [db.items, db.snapshots, db.reviews, db.impressions], async () => {
    await db.snapshots.bulkPut(snapshots);
    await db.items.bulkPut(items);
    await db.reviews.bulkPut(reviews);
    await db.impressions.bulkPut(impressions);
  });
  await enqueueBatch(ops);

  summary.snapshots = snapshots.length;
  summary.items = items.length;
  summary.reviews = reviews.length;
  summary.impressions = impressions.length;
  return summary;
}
