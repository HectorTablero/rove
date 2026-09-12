import type { Schema } from 'mongoose';

/**
 * The index every synced collection needs, and only that one.
 *
 * `GET /sync?since=` is a range scan on `updatedAt` inside one user, and it runs once a minute per
 * open client whether or not anything changed. Without a compound index that is a scan of the
 * user's whole collection per pull; with it, a delta is an index seek returning almost nothing.
 * `updatedAt` is Mongoose's own timestamp — it is bumped on every save, which is exactly what the
 * cursor comparison relies on.
 */
export function syncedIndexes(schema: Schema): void {
  schema.index({ userId: 1, updatedAt: 1 });
}
