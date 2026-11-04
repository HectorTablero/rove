import { XMLParser } from 'fast-xml-parser';
import { config } from '../config';
import { HttpError } from '../errors';
import { cleanText, decodeEntities } from './html';

/* Reading a feed from the self-hosted RSSHub.
 *
 * RSSHub answers RSS 2.0; this reads exactly the four fields the pollers use and nothing that
 * depends on a route's quirks. The RSSHub base URL is the server's own configuration — it is an
 * infrastructure address, not a user setting — and a missing one fails with a code the status
 * screen can name. */

export interface FeedEntry {
  title: string;
  link: string;
  /** The description with its HTML reduced to lines of text. Labels the route wrote (演出时间：…)
      survive, which is what the pollers parse. */
  text: string;
  /** The description as it came, for the snapshot body. */
  html: string;
  pubDate: string | null;
  /** The first `<img>` in the description: every route used here puts its poster there. */
  image: string | null;
  /** The item's `<category>` elements (Showstart writes the show's styles there). */
  categories: string[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  cdataPropName: '__cdata',
  // A single <item> must still come back as an array.
  isArray: (name) => name === 'item' || name === 'category',
});

/** An http(s) URL from the first `<img src>`, or null. Protocol-relative sources become https. */
export function firstImage(html: string): string | null {
  const src = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  if (!src) return null;
  const url = decodeEntities(src).trim().replace(/^\/\//, 'https://');
  return /^https?:\/\//i.test(url) ? url : null;
}

const asText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('__cdata' in record) return asText(record.__cdata);
    if ('#text' in record) return asText(record['#text']);
    return '';
  }
  return String(value);
};

/** Block-level tags become line breaks, everything else is dropped, entities decoded. */
export function htmlToLines(html: string): string {
  const withBreaks = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return cleanText(decodeEntities(withBreaks))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function parseFeed(xml: string): FeedEntry[] {
  let parsed: { rss?: { channel?: { item?: unknown[] } } };
  try {
    parsed = parser.parse(xml) as typeof parsed;
  } catch {
    throw new HttpError(502, 'poll.bad_feed');
  }
  const items = parsed.rss?.channel?.item;
  if (!Array.isArray(items)) throw new HttpError(502, 'poll.bad_feed');
  return items
    .map((item) => {
      const record = item as Record<string, unknown>;
      const html = asText(record.description);
      return {
        title: cleanText(asText(record.title)),
        link: asText(record.link).trim(),
        text: htmlToLines(html),
        html,
        pubDate: asText(record.pubDate).trim() || null,
        image: firstImage(html),
        categories: (Array.isArray(record.category) ? record.category : [])
          .map((c) => cleanText(asText(c)))
          .filter(Boolean),
      };
    })
    .filter((entry) => entry.title && entry.link);
}

/** Fetch one RSSHub route, e.g. `/douban/event/hot/118282`. */
export async function fetchFeed(route: string): Promise<FeedEntry[]> {
  const base = config.rsshubBaseUrl.replace(/\/+$/, '');
  if (!base) throw new HttpError(503, 'poll.rsshub_not_configured');
  let res: Response;
  try {
    res = await fetch(`${base}${route}`, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new HttpError(502, 'poll.rsshub_unreachable');
  }
  if (!res.ok) throw new HttpError(502, `poll.rsshub_http_${res.status}`);
  return parseFeed(await res.text());
}
