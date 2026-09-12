import type {
  ImpressionCreateInput,
  ImpressionDto,
  ItemCreateInput,
  ItemDto,
  ItemUpdateInput,
  ReviewDto,
  ReviewUpdateInput,
  SettingsDto,
  SettingsInput,
  SnapshotCreateInput,
  SnapshotDto,
  SnapshotUpdateInput,
} from '@rove/shared';
import { newObjectId } from '@rove/shared';
import { apiPut } from '@/lib/apiClient';
import { db, setMeta } from './db';
import { enqueue } from './outbox';
import { getReview, getSettings } from './repo';

/* Every write the UI makes: apply to the local store first, then queue the same write for the
   server. The local apply is what the screen shows immediately; the queued op is what the other
   devices see once it has been pushed and pulled. Neither waits for the network. */

const now = (): string => new Date().toISOString();

// --- Items ---

export async function createItem(input: ItemCreateInput): Promise<ItemDto> {
  const id = input.id ?? newObjectId();
  const createdAt = input.createdAt ?? now();
  const item = { ...input, id, createdAt, updatedAt: createdAt } as ItemDto;
  await db.items.put(item);
  await enqueue('POST', '/items', { ...input, id, createdAt });
  return item;
}

export async function updateItem(id: string, input: ItemUpdateInput): Promise<void> {
  await db.items
    .where('id')
    .equals(id)
    .modify((item) => {
      Object.assign(item, input, { updatedAt: now() });
    });
  await enqueue('PATCH', `/items/${id}`, input);
}

/** Deletes the item and its review together: a rating of nothing is nothing. */
export async function deleteItem(id: string): Promise<void> {
  const review = await getReview(id);
  await db.transaction('rw', [db.items, db.reviews], async () => {
    await db.items.delete(id);
    if (review) await db.reviews.delete(review.id);
  });
  if (review) await enqueue('DELETE', `/reviews/${review.id}`);
  await enqueue('DELETE', `/items/${id}`);
}

// --- Snapshots ---

export async function createSnapshot(input: SnapshotCreateInput): Promise<SnapshotDto> {
  const id = input.id ?? newObjectId();
  const createdAt = input.createdAt ?? now();
  const snapshot: SnapshotDto = { ...input, id, createdAt, updatedAt: createdAt };
  await db.snapshots.put(snapshot);
  await enqueue('POST', '/snapshots', { ...input, id, createdAt });
  return snapshot;
}

export async function updateSnapshot(id: string, input: SnapshotUpdateInput): Promise<void> {
  await db.snapshots
    .where('id')
    .equals(id)
    .modify((snapshot) => {
      Object.assign(snapshot, input, { updatedAt: now() });
    });
  await enqueue('PATCH', `/snapshots/${id}`, input);
}

// --- Reviews ---

/**
 * The review for an item, created on first write.
 *
 * One per item, and the server holds a unique index on `(userId, itemId)` to make that true across
 * devices: two phones rating the same place offline collide there, one create 409s, and the pull
 * hands the loser the winner's row. Locally there is nothing to collide with.
 */
export async function upsertReview(itemId: string, input: ReviewUpdateInput): Promise<ReviewDto> {
  const existing = await getReview(itemId);
  if (existing) {
    const updated: ReviewDto = { ...existing, ...input, updatedAt: now() };
    await db.reviews.put(updated);
    await enqueue('PATCH', `/reviews/${existing.id}`, input);
    return updated;
  }
  const id = newObjectId();
  const createdAt = now();
  const review: ReviewDto = {
    id,
    itemId,
    rating: input.rating ?? null,
    notes: input.notes ?? '',
    visits: input.visits ?? [],
    createdAt,
    updatedAt: createdAt,
  };
  await db.reviews.put(review);
  await enqueue('POST', '/reviews', { id, createdAt, itemId, ...input });
  return review;
}

// --- Impressions ---

export async function logImpression(
  input: Omit<ImpressionCreateInput, 'id' | 'createdAt' | 'at' | 'action'> & {
    at?: string;
    action?: ImpressionDto['action'];
  },
): Promise<ImpressionDto> {
  const id = newObjectId();
  const createdAt = now();
  const impression: ImpressionDto = {
    id,
    itemId: input.itemId,
    surface: input.surface,
    at: input.at ?? createdAt,
    action: input.action ?? null,
    createdAt,
    updatedAt: createdAt,
  };
  await db.impressions.put(impression);
  await enqueue('POST', '/impressions', { ...impression, updatedAt: undefined });
  return impression;
}

// --- Settings ---

/**
 * Settings are the one write that goes to the server directly rather than through the outbox.
 *
 * A PUT replaces the whole document, so queuing several offline would replay stale copies over
 * each other; and the key inside it must be sent exactly once, when the user chooses to. The local
 * mirror is updated optimistically with everything but the key, of which only the `hasLlmKey`
 * flag is known here.
 */
export async function saveSettings(input: SettingsInput): Promise<SettingsDto> {
  const current = await getSettings();
  const { llmApiKey, ...rest } = input;
  const optimistic: SettingsDto = {
    ...current,
    ...rest,
    hasLlmKey: llmApiKey === undefined ? current.hasLlmKey : llmApiKey.length > 0,
  };
  await setMeta('settings', optimistic);
  const saved = await apiPut<SettingsDto>('/settings', input);
  await setMeta('settings', saved);
  return saved;
}
