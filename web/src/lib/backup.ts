import type { ImpressionDto, ItemDto, ReviewDto, SnapshotDto } from '@rove/shared';
import { z } from 'zod';
import { db } from '@/db/db';

/* A backup is the whole local store as JSON, reviews first.
 *
 * Reviews first in the file for the same reason they are a separate collection: items can be
 * re-derived from their snapshots and re-geocoded, but a rating and a note cannot be recovered
 * from anywhere. Anyone reading a truncated file should meet the irreplaceable half first.
 *
 * The envelope is validated on the way back in (`backupEnvelopeSchema`), with the same
 * parse-don't-trust posture as everything else that crosses a boundary. Impressions are included
 * because they are the training data for ranking later, and cheap. */

export const BACKUP_FORMAT = 'rove-backup';
export const BACKUP_VERSION = 1;

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  appVersion: string;
  reviews: ReviewDto[];
  items: ItemDto[];
  snapshots: SnapshotDto[];
  impressions: ImpressionDto[];
}

export async function buildBackupEnvelope(): Promise<BackupEnvelope> {
  const [reviews, items, snapshots, impressions] = await Promise.all([
    db.reviews.toArray(),
    db.items.toArray(),
    db.snapshots.toArray(),
    db.impressions.toArray(),
  ]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    reviews,
    items,
    snapshots,
    impressions,
  };
}

/* Loose on purpose: the file only has to be *this app's* backup and carry the four arrays. Each
   row is re-validated by the shared create schemas when the importer replays it, which is where
   a malformed row is refused with a reason. Refusing the whole file here for one bad row would
   throw away the other thousand. */
export const backupEnvelopeSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.iso.datetime(),
  appVersion: z.string(),
  reviews: z.array(z.unknown()),
  items: z.array(z.unknown()),
  snapshots: z.array(z.unknown()),
  impressions: z.array(z.unknown()),
});

export const backupFileName = (envelope: BackupEnvelope): string =>
  `rove-backup-${envelope.exportedAt.slice(0, 10)}.json`;
