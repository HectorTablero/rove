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

export const SOURCES: readonly SourceManifest[] = [instagramOembed, xiaohongshuShare, genericOg];

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
