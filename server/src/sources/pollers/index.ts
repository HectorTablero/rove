import { FILM_TTL_DAYS, MAX_PRICE_LENGTH } from '@rove/shared';
import { HttpError } from '../../errors';
import { expiryFor, labelled, parseWhen } from './dates';
import type { CandidateDraft, Poller } from './types';

/* One poller per feed, each a route and a mapping. The mappings read what RSSHub's route writes
   into the description — a labelled line per field — and fall back to scanning the whole text
   for a date, so a route that rewords a label degrades to "time unknown" rather than to nothing.
   The description shapes are read from RSSHub's route sources (lib/routes/<site>/); fixtures for
   them live beside the tests. */

const param = (region: Parameters<Poller['route']>[0], source: string, name: string): string => {
  const value = region.sourceParams[source]?.[name];
  if (!value) throw new HttpError(503, `poll.missing_param:${source}.${name}`);
  return value;
};

const clip = (text: string | null): string | null =>
  text ? text.slice(0, MAX_PRICE_LENGTH).trim() || null : null;

type Entry = Parameters<Poller['map']>[0];

/** The fields every event mapping fills the same way. */
const eventDraft = (
  entry: Entry,
  now: Date,
  fields: Pick<CandidateDraft, 'when' | 'venue' | 'price'> & { categories?: string[] },
): CandidateDraft => ({
  kind: 'event',
  title: entry.title,
  link: entry.link,
  text: entry.text,
  when: fields.when,
  venue: fields.venue,
  price: clip(fields.price),
  coverUrl: entry.image,
  categories: fields.categories ?? entry.categories,
  expiresAt: expiryFor(fields.when, now),
  entry,
});

/** RSSHub's Damai route: `/damai/activity/:city/:category/:subcategory`. */
export const damaiPoller: Poller = {
  id: 'damai',
  route: (region) =>
    `/damai/activity/${encodeURIComponent(param(region, 'damai', 'city'))}/全部/全部`,
  map(entry, region, now) {
    const showtime = labelled(entry.text, ['演出时间', '时间', 'showtime']);
    return eventDraft(entry, now, {
      when: parseWhen(showtime ?? entry.text, region.tz),
      venue: labelled(entry.text, ['场馆', '演出场馆', '地点', 'venue']),
      price: labelled(entry.text, ['票价', '价格', 'price']),
    });
  },
};

/** `/showstart/event/:cityCode`. The route writes `演出时间：`, `地址：城市 - 场地`, `艺人：`,
    `票价：` lines after the poster, and the show's styles as `<category>`. */
export const showstartPoller: Poller = {
  id: 'showstart',
  route: (region) =>
    `/showstart/event/${encodeURIComponent(param(region, 'showstart', 'cityCode'))}`,
  map(entry, region, now) {
    const showtime = labelled(entry.text, ['演出时间', '时间', 'showTime']);
    const address = labelled(entry.text, ['地址', '场地', '演出场馆', '场馆', '地点', 'siteName']);
    return eventDraft(entry, now, {
      when: parseWhen(showtime ?? entry.text, region.tz),
      // "深圳 - HOU Live" → "HOU Live": the city is the region, the site is what geocodes.
      venue: address ? address.replace(/^[^-–]+\s+[-–]\s+/, '').trim() || address : null,
      price: labelled(entry.text, ['票价', '价格']),
    });
  },
};

/** `/douban/event/hot/:locationId`. The route writes the cover and then one unlabelled line,
    `info/subtype/price_range`, so price and type are read by position from the end. */
export const doubanEventsPoller: Poller = {
  id: 'douban-events',
  route: (region) =>
    `/douban/event/hot/${encodeURIComponent(param(region, 'douban-events', 'locationId'))}`,
  map(entry, region, now) {
    const line =
      entry.text
        .split('\n')
        .reverse()
        .find((l) => l.split('/').length >= 3) ?? null;
    const parts = line?.split('/').map((part) => part.trim()) ?? [];
    const price = parts.length >= 3 ? parts[parts.length - 1] : null;
    const subtype = parts.length >= 3 ? parts[parts.length - 2] : null;
    return eventDraft(entry, now, {
      when: parseWhen(labelled(entry.text, ['时间', 'time']) ?? entry.text, region.tz),
      venue: labelled(entry.text, ['地点', '地址', 'address']),
      price: price || null,
      categories: subtype ? [subtype] : entry.categories,
    });
  },
};

/** The calendar day of an instant in a zone, as `YYYY-MM-DD`. */
const ymdIn = (at: Date, tz: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

/** `/maoyan/hot` — nationwide, so the region contributes nothing but its zone. The release date
    is the item's pubDate (midnight in China); the poster is the description's image. */
export const maoyanPoller: Poller = {
  id: 'maoyan',
  route: () => '/maoyan/hot',
  map(entry, region, now) {
    // "[8.5分] 片名" → the name; the score stays in the text.
    const title = entry.title.replace(/^\[[\d.]+分\]\s*/, '').trim();
    if (!title) return null;
    const released = entry.pubDate ? new Date(entry.pubDate) : null;
    const release =
      labelled(entry.text, ['上映时间', '上映日期', 'release']) ??
      (released && !Number.isNaN(released.getTime()) ? ymdIn(released, region.tz) : null);
    const when = release ? parseWhen(release, region.tz) : null;
    const releaseMs = when ? Date.parse(when.start) : now.getTime();
    return {
      kind: 'film',
      title,
      link: entry.link,
      text: entry.text,
      when,
      venue: null,
      price: null,
      coverUrl: entry.image,
      categories: entry.categories,
      expiresAt: new Date(
        Math.max(releaseMs, now.getTime()) + FILM_TTL_DAYS * 86_400_000,
      ).toISOString(),
      entry,
    };
  },
};

export const POLLERS: readonly Poller[] = [
  doubanEventsPoller,
  showstartPoller,
  damaiPoller,
  maoyanPoller,
];

export function pollerById(id: string): Poller {
  const poller = POLLERS.find((p) => p.id === id);
  if (!poller) throw new HttpError(400, 'poll.unknown_source');
  return poller;
}
