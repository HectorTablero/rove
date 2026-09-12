import type { ImpressionDto, ItemDto, ReviewDto, SnapshotDto } from '@rove/shared';
import Dexie, { type EntityTable } from 'dexie';

/* Local-first store: the source of truth the UI reads from. Every table holds the DTO exactly as
   the server sends it — nothing here references anything else by name, so there is no join to keep
   fresh and no second "local" shape to map through. The sync engine (sync.ts) mirrors the server
   into these tables; mutations.ts writes them and queues the same write for the server. */

/** A queued mutation, replayed against the REST API in order once online. */
export interface OutboxOp {
  seq?: number;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  /**
   * A 404 from the server is expected for this op, and is not a lost write.
   *
   * Set only by the backup importer. Restoring a file written months ago legitimately references
   * things the server no longer has, and those writes come back 404. Nothing was lost: the target
   * stopped existing before the restore began. Outside a restore a POST 404 is a genuine loss and
   * belongs in the dead-letter table.
   */
  tolerate404?: boolean;
}

/**
 * An op the server refused, kept after it left the queue.
 *
 * The queue has to drop a write the server answers with an unhandled 4xx — retrying it forever
 * would jam every later write behind it. But the local Dexie copy still holds the change, so the
 * UI goes on showing it as saved. Landing here is what makes that loss a fact the app can report
 * rather than a line in a console nobody reads.
 */
export interface DeadLetterOp {
  id?: number;
  method: OutboxOp['method'];
  path: string;
  body?: unknown;
  status: number;
  code: string;
  failedAt: string;
}

interface MetaRow {
  key: string;
  value: unknown;
}

export const db = new Dexie('rove') as Dexie & {
  items: EntityTable<ItemDto, 'id'>;
  snapshots: EntityTable<SnapshotDto, 'id'>;
  reviews: EntityTable<ReviewDto, 'id'>;
  impressions: EntityTable<ImpressionDto, 'id'>;
  outbox: EntityTable<OutboxOp, 'seq'>;
  deadLetter: EntityTable<DeadLetterOp, 'id'>;
  meta: EntityTable<MetaRow, 'key'>;
};

/* v1. Indexes are the queries each screen makes and nothing more:
     - items by kind/status for the list's filter and the map's markers, `*categories` multi-entry
       for a category filter, `expiresAt` so an expiry sweep is a range rather than a scan.
     - snapshots by url, so sharing the same link twice finds the first snapshot.
     - reviews by itemId (one per item), impressions by itemId and by time.
   Nothing indexes coordinates: at personal scale the map draws every saved item, and a proximity
   check for dedupe walks a few hundred rows in memory. */
db.version(1).stores({
  items: 'id, kind, status, regionId, *categories, expiresAt, updatedAt',
  snapshots: 'id, url, sourceId',
  reviews: 'id, itemId',
  impressions: 'id, itemId, at',
  outbox: '++seq',
  deadLetter: '++id, failedAt',
  meta: 'key',
});

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Wipe everything local (used on sign-out). Keeps the database usable afterwards. */
export async function clearLocalData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}
