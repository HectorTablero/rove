import type { ImpressionDto, ItemDto, ReviewDto, SettingsDto, SnapshotDto } from '@rove/shared';
import { DEFAULT_SETTINGS } from '@rove/shared';
import { db, setMeta, type OutboxOp } from '@/db/db';
import { queryClient } from '@/lib/queryClient';

/* Putting data into the real local store, so component tests read it back through the real repo.
 *
 * Not a mock of `@/db/repo` or `@/api/hooks`. fake-indexeddb makes the genuine article cheap enough
 * to use instead; `setup.ts` installs it globally and resets it between tests.
 *
 * Imports `@/db/db` only, never `@/db/outbox` — that reaches the sync engine, which a fixture has no
 * business starting. */

/** Empty every table and invalidate the read layer's caches. */
export async function resetDb(): Promise<void> {
  if (!db.isOpen()) await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  queryClient.clear();
}

export interface SeedData {
  items?: ItemDto[];
  snapshots?: SnapshotDto[];
  reviews?: ReviewDto[];
  impressions?: ImpressionDto[];
  settings?: Partial<SettingsDto>;
  /** Pre-existing queued ops, for a test about the sync pill or a backlog. */
  outbox?: OutboxOp[];
}

export async function seed(data: SeedData): Promise<void> {
  await db.items.bulkPut(data.items ?? []);
  await db.snapshots.bulkPut(data.snapshots ?? []);
  await db.reviews.bulkPut(data.reviews ?? []);
  await db.impressions.bulkPut(data.impressions ?? []);
  if (data.outbox?.length) await db.outbox.bulkAdd(data.outbox);
  await seedSettings(data.settings ?? {});
}

/**
 * Settings, written to both places that read them.
 *
 * Dexie's `meta` row is what `repo.getSettings()` returns. The query cache is what `lib/notify.ts`
 * consults synchronously to decide whether a routine success toast is suppressed — it reads the
 * module singleton directly rather than through a hook, because it is called from places that have
 * already unmounted. `quietNotifications` defaults to **true**, so a test asserting a success toast
 * without setting it will watch that toast silently not exist.
 */
export async function seedSettings(patch: Partial<SettingsDto>): Promise<void> {
  const settings: SettingsDto = { ...DEFAULT_SETTINGS, ...patch };
  await setMeta('settings', settings);
  queryClient.setQueryData(['settings'], settings);
}

/** What the component under test queued for the server. Empty after `resetDb`. */
export const outboxOps = (): Promise<OutboxOp[]> => db.outbox.orderBy('seq').toArray();

const T = '2026-08-01T09:00:00.000Z';

/** A saved place in Shenzhen, with every field a test rarely cares about filled in. */
export const aPlace = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'title'>): ItemDto =>
  ({
    regionId: 'shenzhen',
    kind: 'place',
    altTitles: [],
    categories: [],
    status: 'saved',
    snapshotIds: [],
    sourceUrls: [],
    expiresAt: null,
    location: {
      point: { lon: 114.0579, lat: 22.5431, datum: 'GCJ02' },
      address: null,
      providerRef: null,
    },
    createdAt: T,
    updatedAt: T,
    ...patch,
  }) as ItemDto;
