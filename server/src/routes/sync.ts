import type { SyncCollection, SyncResponse } from '@rove/shared';
import { syncQuerySchema } from '@rove/shared';
import { Hono } from 'hono';
import type { Types } from 'mongoose';
import type { AppEnv } from '../middleware/session';
import { queryValidator } from '../middleware/validate';
import { trackEvent, userHash } from '../lib/telemetry';
import { Deletion, isCursorStale } from '../models/deletion';
import { Impression } from '../models/impression';
import { Item } from '../models/item';
import { Review } from '../models/review';
import { Snapshot } from '../models/snapshot';
import { issueWsTicket } from '../services/liveSync';
import { getSettings } from '../services/settingsService';
import {
  impressionToDto,
  itemToDto,
  reviewToDto,
  snapshotToDto,
  type LeanImpression,
  type LeanItem,
  type LeanReview,
  type LeanSnapshot,
} from '../dto';

interface LeanDeletion {
  coll: SyncCollection;
  docId: Types.ObjectId;
  deletedAt: Date;
}

export const syncRouter = new Hono<AppEnv>()
  // Single-use ticket for the live-sync WebSocket (see services/liveSync).
  // GET on purpose: the mutation-broadcast middleware only fires on non-GET.
  .get('/ws-ticket', (c) => c.json({ ticket: issueWsTicket(c.get('userId')) }))
  /** Pull endpoint for the local-first clients: everything changed since the cursor. */
  .get('/', queryValidator(syncQuerySchema), async (c) => {
    const userId = c.get('userId');
    const { since } = c.req.valid('query');
    // Captured before the queries run: anything written mid-request is re-sent next pull.
    const now = new Date();
    const serverTime = now.toISOString();
    const cursor = since ? new Date(since) : null;
    /* No cursor, or one so old its tombstones have been pruned — either way a delta can't describe
       what this client missed, so it gets the whole state and reconciles by absence. Answering a
       stale cursor incrementally would look perfectly healthy and leave deleted docs on the device
       forever. First sync takes this branch too: it costs nothing against an empty local store,
       and it leaves the client with one reconciliation path instead of two. */
    const reset = !cursor || isCursorStale(cursor, now);
    const changedSince = reset ? {} : { updatedAt: { $gt: cursor } };

    const queryStartedAt = performance.now();
    const [items, snapshots, reviews, impressions, settings, deletions] = await Promise.all([
      Item.find({ userId, ...changedSince }).lean(),
      Snapshot.find({ userId, ...changedSince }).lean(),
      Review.find({ userId, ...changedSince }).lean(),
      Impression.find({ userId, ...changedSince }).lean(),
      getSettings(userId),
      // A full state names every doc that exists; the ones it doesn't name are the deletions.
      reset ? Promise.resolve([]) : Deletion.find({ userId, deletedAt: { $gt: cursor } }).lean(),
    ]);
    const queryMs = Math.round(performance.now() - queryStartedAt);

    /* The one endpoint whose *cost* is not proportional to what the caller asked for: a delta is
       four indexed range queries returning almost nothing; a reset is the same four returning
       everything the user has — including every raw snapshot body — chosen by the server rather
       than requested. Reported in full, never sampled, with the number that decides whether the
       cost is acceptable: how old the cursor was that triggered it. */
    if (reset) {
      trackEvent('sync_reset_served', {
        user: userHash(userId),
        client_id: c.req.header('x-client-id'),
        cursor_age_ms: cursor ? now.getTime() - cursor.getTime() : undefined,
        first_sync: !cursor,
        items: items.length,
        // Counted apart from items: a snapshot row can be a quarter of a megabyte.
        snapshots: snapshots.length,
        reviews: reviews.length,
        impressions: impressions.length,
        query_ms: queryMs,
      });
    } else if (queryMs >= 250) {
      trackEvent('sync_delta_slow', {
        user: userHash(userId),
        query_ms: queryMs,
        changed: items.length + snapshots.length + reviews.length + impressions.length,
        deletions: deletions.length,
      });
    }

    const response: SyncResponse = {
      serverTime,
      reset,
      /* Every collection is always sent, never omitted when empty. Under `reset` the client deletes
         every local id the response did not name, so "absent" and "none" must not look alike — a
         client reading absence as emptiness would delete its whole store. */
      items: (items as unknown as LeanItem[]).map(itemToDto),
      snapshots: (snapshots as unknown as LeanSnapshot[]).map(snapshotToDto),
      reviews: (reviews as unknown as LeanReview[]).map(reviewToDto),
      impressions: (impressions as unknown as LeanImpression[]).map(impressionToDto),
      settings,
      deletions: (deletions as unknown as LeanDeletion[]).map((d) => ({
        coll: d.coll,
        docId: d.docId.toString(),
        deletedAt: d.deletedAt.toISOString(),
      })),
    };
    return c.json(response);
  });
