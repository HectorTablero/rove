import 'fake-indexeddb/auto';
import type { ItemDto } from '@rove/shared';
import { beforeEach, expect, it } from 'vitest';
import { aPlace, resetDb, seed } from '@/test/seed';
import { getItems } from './repo';

/* A suggestion for something already over is gone from every read; what you saved is not. */

const event = (id: string, status: ItemDto['status'], end: string): ItemDto =>
  ({
    ...aPlace({ id, title: id, status }),
    kind: 'event',
    venue: null,
    location: null,
    when: { start: end, end: null, tz: 'Asia/Shanghai', allDay: false },
    expiresAt: null,
  }) as ItemDto;

beforeEach(resetDb);

it('hides a past suggestion even before it expires, and keeps a past saved event', async () => {
  const past = '2000-01-01T00:00:00.000Z';
  const future = '2999-01-01T00:00:00.000Z';
  await seed({
    items: [
      event('old-suggestion', 'candidate', past),
      event('old-saved', 'saved', past),
      event('new-suggestion', 'candidate', future),
    ],
  });

  const ids = (await getItems()).map((item) => item.id).sort();

  expect(ids).toEqual(['new-suggestion', 'old-saved']);
});
