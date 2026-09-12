import { FILM_TTL_DAYS } from '@rove/shared';
import { HttpError } from '../../errors';
import { expiryFor, labelled, parseWhen } from './dates';
import type { Poller } from './types';

/* One poller per feed, each a route and a mapping. The mappings read what RSSHub's route writes
   into the description — a labelled line per field — and fall back to scanning the whole text
   for a date, so a route that rewords a label degrades to "time unknown" rather than to nothing.
   Fixtures for these live beside the tests; the live feeds are checked against a self-hosted
   RSSHub, not from here. */

const param = (region: Parameters<Poller['route']>[0], source: string, name: string): string => {
  const value = region.sourceParams[source]?.[name];
  if (!value) throw new HttpError(503, `poll.missing_param:${source}.${name}`);
  return value;
};

/** RSSHub's Damai route: `/damai/activity/:city/:category/:subcategory`. */
export const damaiPoller: Poller = {
  id: 'damai',
  route: (region) =>
    `/damai/activity/${encodeURIComponent(param(region, 'damai', 'city'))}/全部/全部`,
  map(entry, region, now) {
    const venue = labelled(entry.text, ['场馆', '演出场馆', '地点', 'venue']);
    const showtime = labelled(entry.text, ['演出时间', '时间', 'showtime']);
    const when = parseWhen(showtime ?? entry.text, region.tz);
    return {
      kind: 'event',
      title: entry.title,
      link: entry.link,
      text: entry.text,
      when,
      venue,
      expiresAt: expiryFor(when, now),
      entry,
    };
  },
};

/** `/showstart/event/:cityCode`. */
export const showstartPoller: Poller = {
  id: 'showstart',
  route: (region) =>
    `/showstart/event/${encodeURIComponent(param(region, 'showstart', 'cityCode'))}`,
  map(entry, region, now) {
    const venue = labelled(entry.text, ['场地', '演出场馆', '场馆', '地点', 'siteName']);
    const showtime = labelled(entry.text, ['演出时间', '时间', 'showTime']);
    const when = parseWhen(showtime ?? entry.text, region.tz);
    return {
      kind: 'event',
      title: entry.title,
      link: entry.link,
      text: entry.text,
      when,
      venue,
      expiresAt: expiryFor(when, now),
      entry,
    };
  },
};

/** `/douban/event/hot/:locationId`. The route writes no date line; the text usually carries one. */
export const doubanEventsPoller: Poller = {
  id: 'douban-events',
  route: (region) =>
    `/douban/event/hot/${encodeURIComponent(param(region, 'douban-events', 'locationId'))}`,
  map(entry, region, now) {
    const venue = labelled(entry.text, ['地点', '地址', 'address']);
    const when = parseWhen(labelled(entry.text, ['时间', 'time']) ?? entry.text, region.tz);
    return {
      kind: 'event',
      title: entry.title,
      link: entry.link,
      text: entry.text,
      when,
      venue,
      expiresAt: expiryFor(when, now),
      entry,
    };
  },
};

/** `/maoyan/hot` — nationwide, so the region contributes nothing but its zone. */
export const maoyanPoller: Poller = {
  id: 'maoyan',
  route: () => '/maoyan/hot',
  map(entry, region, now) {
    // "[8.5分] 片名" → the name; the score stays in the text.
    const title = entry.title.replace(/^\[[\d.]+分\]\s*/, '').trim();
    if (!title) return null;
    const release = labelled(entry.text, ['上映时间', '上映日期', 'release']);
    const when = release ? parseWhen(release, region.tz) : null;
    const releaseMs = when ? Date.parse(when.start) : now.getTime();
    return {
      kind: 'film',
      title,
      link: entry.link,
      text: entry.text,
      when,
      venue: null,
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
