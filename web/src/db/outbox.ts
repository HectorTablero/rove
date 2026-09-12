import { captureError } from '@/lib/telemetry';
import { db, type OutboxOp } from './db';
import { isQuotaError } from './storage';
import { kick } from './sync';

/* Queues a mutation for replay against the REST API (see sync.ts's pushOutbox). */

/**
 * Report a local write that failed, then re-throw.
 *
 * Enqueuing is the one step a local write cannot skip, which makes this the single point that
 * covers every mutation without touching any. Quota is called out separately because it is the
 * only failure the user can act on, and the only one that is not a bug: an offline-first app is a
 * database that grows until someone deletes something.
 *
 * Re-thrown rather than swallowed: the caller believing a write succeeded when it did not is the
 * exact divergence the dead-letter table exists to prevent on the server side.
 */
async function reportWriteFailure<T>(scope: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    captureError(err, { scope, quota: isQuotaError(err) });
    throw err;
  }
}

export async function enqueue(
  method: OutboxOp['method'],
  path: string,
  body?: unknown,
): Promise<void> {
  await reportWriteFailure('outbox.enqueue', () => db.outbox.add({ method, path, body }));
  kick('mutation');
}

/** Queue many ops at once, kicking sync a single time — a backup restore, say. */
export async function enqueueBatch(ops: OutboxOp[]): Promise<void> {
  if (!ops.length) return;
  await reportWriteFailure('outbox.enqueueBatch', () => db.outbox.bulkAdd(ops));
  kick('mutation');
}
