import { sourceForUrl } from '@rove/shared';
import { genericOgResolver, resolveOpenGraph } from './genericOg';
import { instagramOembedResolver } from './instagramOembed';
import type { Resolved, Resolver } from './types';
import { xiaohongshuShareResolver } from './xiaohongshuShare';

/* The server's source registry: the resolver behind each manifest in @rove/shared. Looked up by
   the id the shared registry chose for a URL, so which source reads a link is decided in one place
   and this file only has to agree with it — a test asserts that every manifest has a resolver. */

export type { Resolved, Resolver } from './types';
/* The feed side of the registry, so core (the poll service) reaches pollers only through here. */
export { fetchFeed, parseFeed, type FeedEntry } from './rss';
export { POLLERS, pollerById } from './pollers';
export type { CandidateDraft, Poller } from './pollers/types';

/* The polled sources are also pasteable: a Damai page shared into the app is an ordinary web page
   with Open Graph tags, so each borrows the generic resolver under its own id. */
const viaOpenGraph = (id: string): Resolver => ({ id, resolve: resolveOpenGraph });

export const RESOLVERS: readonly Resolver[] = [
  instagramOembedResolver,
  xiaohongshuShareResolver,
  viaOpenGraph('douban-events'),
  viaOpenGraph('showstart'),
  viaOpenGraph('damai'),
  viaOpenGraph('maoyan'),
  genericOgResolver,
];

export function resolverById(id: string): Resolver {
  const resolver = RESOLVERS.find((r) => r.id === id);
  if (!resolver) throw new Error(`no resolver for source "${id}"`);
  return resolver;
}

/** Resolve a URL with whichever source the region claims it for. Null when no source can. */
export async function resolveUrl(
  url: URL,
  regionId: string,
): Promise<{ sourceId: string; resolved: Resolved } | null> {
  const source = sourceForUrl(url, regionId);
  if (!source) return null;
  return { sourceId: source.id, resolved: await resolverById(source.id).resolve(url) };
}
