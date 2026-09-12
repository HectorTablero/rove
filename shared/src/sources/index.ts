import type { SourceManifest } from '../region';

/* The source registry: manifests only, no fetching code.
 *
 * Every source is declared here — what it is called, where it works, what it produces, what it
 * costs — and its resolver is looked up by id in the server. The order matters: `sourceForUrl`
 * takes the first match, so the specific sources come before the generic fallback. */

const host = (url: URL, ...hosts: string[]): boolean =>
  hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));

export const instagramOembed: SourceManifest = {
  id: 'instagram-oembed',
  name: 'Instagram',
  regionIds: '*',
  kinds: ['place', 'event'],
  // Meta's tokenless oEmbed (public posts, since June 2026): official, and the caption comes back.
  tier: 'A',
  matches: (url) => host(url, 'instagram.com') && /^\/(p|reel|reels)\//.test(url.pathname),
  polls: false,
};

export const xiaohongshuShare: SourceManifest = {
  id: 'xiaohongshu-share',
  name: '小红书',
  regionIds: ['shenzhen'],
  kinds: ['place', 'event'],
  // A share link resolves to a public page whose state blob carries the note; no account involved.
  tier: 'B',
  matches: (url) => host(url, 'xhslink.com', 'xhslink.cn', 'xiaohongshu.com'),
  polls: false,
};

/* The four feeds a self-hosted RSSHub reads for the Greater Bay Area. Each is also claimed as a
   pasted-link source, so a Damai page shared into the app is read by the generic resolver rather
   than refused. `params` names what the region has to supply. */

export const doubanEvents: SourceManifest = {
  id: 'douban-events',
  name: '豆瓣同城',
  regionIds: ['shenzhen'],
  kinds: ['event'],
  // A public JSON API behind RSSHub's route; no cookie.
  tier: 'A',
  matches: (url) => host(url, 'douban.com') && /\/event\//.test(url.pathname),
  polls: true,
  params: ['locationId'],
};

export const showstart: SourceManifest = {
  id: 'showstart',
  name: '秀动',
  regionIds: ['shenzhen'],
  kinds: ['event'],
  tier: 'A',
  matches: (url) => host(url, 'showstart.com'),
  polls: true,
  params: ['cityCode'],
};

export const damai: SourceManifest = {
  id: 'damai',
  name: '大麦',
  regionIds: ['shenzhen'],
  kinds: ['event'],
  // A search endpoint RSSHub flags as anti-crawler: expect it to be the first to break.
  tier: 'B',
  matches: (url) => host(url, 'damai.cn'),
  polls: true,
  params: ['city'],
};

export const maoyan: SourceManifest = {
  id: 'maoyan',
  name: '猫眼',
  regionIds: ['shenzhen'],
  kinds: ['film'],
  // Nationwide "in cinemas now": no city and no showtimes, which is why a film has no location.
  tier: 'A',
  matches: (url) => host(url, 'maoyan.com'),
  polls: true,
  params: [],
};

export const genericOg: SourceManifest = {
  id: 'generic-og',
  name: 'Web page',
  regionIds: '*',
  kinds: ['place', 'event', 'film'],
  tier: 'B',
  // The fallback: anything http(s) that nothing above claimed.
  matches: (url) => url.protocol === 'https:' || url.protocol === 'http:',
  polls: false,
};

export const SOURCES: readonly SourceManifest[] = [
  instagramOembed,
  xiaohongshuShare,
  doubanEvents,
  showstart,
  damai,
  maoyan,
  genericOg,
];

export function sourceById(id: string): SourceManifest {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) throw new Error(`unknown source "${id}"`);
  return source;
}

/** The source a URL belongs to, within a region, or null for something no source can read. */
export function sourceForUrl(url: URL, regionId: string): SourceManifest | null {
  return (
    SOURCES.find(
      (s) => (s.regionIds === '*' || s.regionIds.includes(regionId)) && s.matches(url),
    ) ?? null
  );
}
