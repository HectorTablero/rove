import type { ImpressionDto, ItemDto, ReviewDto, SettingsDto, SnapshotDto } from '@rove/shared';
import { DEFAULT_SETTINGS } from '@rove/shared';
import { overlaps, weekendWindow } from '@/lib/when';
import { db, getMeta } from './db';

/* Every read the UI makes, against the local store. Nothing here touches the network. */

export interface ItemFilter {
  status?: ItemDto['status'][];
  kind?: ItemDto['kind'][];
  /** Case-folded substring match over title, alt titles and categories. */
  query?: string;
  /** Only items with a time window overlapping the coming weekend in the region's zone. */
  weekend?: { now: Date; tz: string };
}

/** Fold for matching: NFKC so full-width and half-width forms compare equal, then case. Not
    ASCII-only, and not stripping anything — `文和友` must match `文和友`. */
export const foldText = (text: string): string =>
  text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

export async function getItems(filter: ItemFilter = {}): Promise<ItemDto[]> {
  const now = new Date().toISOString();
  /* A candidate past its expiry is a suggestion for something that has happened. Hidden here, on
     every read, rather than deleted: the server sweeps them a month later, and until then a
     restore or a clock skew cannot resurrect a stale inbox. */
  let items = (await db.items.toArray()).filter(
    (item) => !(item.status === 'candidate' && item.expiresAt !== null && item.expiresAt < now),
  );
  if (filter.status?.length) items = items.filter((item) => filter.status!.includes(item.status));
  if (filter.weekend) {
    const window = weekendWindow(filter.weekend.now, filter.weekend.tz);
    items = items.filter(
      (item) => item.kind !== 'place' && item.when && overlaps(item.when, window),
    );
  }
  if (filter.kind?.length) items = items.filter((item) => filter.kind!.includes(item.kind));
  const query = filter.query ? foldText(filter.query.trim()) : '';
  if (query) {
    items = items.filter((item) =>
      [item.title, ...item.altTitles, ...item.categories].some((text) =>
        foldText(text).includes(query),
      ),
    );
  }
  // Newest first: the thing you just saved is the thing you are looking for.
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export const getItem = (id: string): Promise<ItemDto | undefined> => db.items.get(id);

export const getReview = (itemId: string): Promise<ReviewDto | undefined> =>
  db.reviews.where('itemId').equals(itemId).first();

export const getSnapshot = (id: string): Promise<SnapshotDto | undefined> => db.snapshots.get(id);

export const getSnapshotByUrl = (url: string): Promise<SnapshotDto | undefined> =>
  db.snapshots.where('url').equals(url).first();

export const getImpressions = (itemId: string): Promise<ImpressionDto[]> =>
  db.impressions.where('itemId').equals(itemId).sortBy('at');

/** The account settings as last pulled, or the shipped defaults before the first pull. */
export async function getSettings(): Promise<SettingsDto> {
  const stored = await getMeta<Partial<SettingsDto>>('settings');
  return { ...DEFAULT_SETTINGS, ...stored };
}
