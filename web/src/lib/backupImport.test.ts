import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';

vi.mock('@/db/sync', () => ({ kick: () => {} }));
// The build-time constant the envelope stamps; the logic project's `define` does not reach a
// module imported dynamically after the file has started.
vi.stubGlobal('__APP_VERSION__', '0.0.0-test');

const { buildBackupEnvelope } = await import('./backup');
const { importBackup } = await import('./backupImport');

const T = '2026-08-01T09:00:00.000Z';
const item = {
  id: '507f1f77bcf86cd799439011',
  regionId: 'shenzhen',
  kind: 'place' as const,
  title: '文和友',
  altTitles: [],
  categories: [],
  status: 'saved' as const,
  snapshotIds: [],
  sourceUrls: [],
  expiresAt: null,
  location: {
    point: { lon: 114.05, lat: 22.54, datum: 'GCJ02' as const },
    address: null,
    providerRef: null,
  },
  createdAt: T,
  updatedAt: T,
};
const review = {
  id: '507f1f77bcf86cd799439012',
  itemId: item.id,
  rating: 4,
  notes: 'good',
  visits: [T],
  createdAt: T,
  updatedAt: T,
};

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('backup round trip', () => {
  it('exports reviews first and restores everything through the outbox', async () => {
    await db.items.put(item);
    await db.reviews.put(review);
    const envelope = await buildBackupEnvelope();
    expect(Object.keys(envelope).indexOf('reviews')).toBeLessThan(
      Object.keys(envelope).indexOf('items'),
    );

    await Promise.all(db.tables.map((t) => t.clear()));
    const summary = await importBackup(JSON.stringify(envelope));

    expect(summary).toMatchObject({ items: 1, reviews: 1, skipped: 0, invalid: 0 });
    expect(await db.items.get(item.id)).toMatchObject({ title: '文和友' });
    const ops = await db.outbox.toArray();
    expect(ops.map((op) => op.path)).toEqual(['/items', '/reviews']);
    expect(ops.every((op) => op.tolerate404)).toBe(true);
  });

  it('skips rows already present and counts rows that fail validation', async () => {
    await db.items.put(item);
    const envelope = await buildBackupEnvelope();
    envelope.items.push({ ...item, id: '507f1f77bcf86cd799439013', location: null } as never);

    const summary = await importBackup(JSON.stringify(envelope));

    expect(summary.skipped).toBe(1);
    expect(summary.invalid).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('refuses a file that is not a Rove backup', async () => {
    await expect(importBackup('{"format":"other"}')).rejects.toThrow();
  });
});
