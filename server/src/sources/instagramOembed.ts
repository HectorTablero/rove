import { parse } from 'node-html-parser';
import { resolveOpenGraph } from './genericOg';
import { canonicalize, capBody, capText, cleanText, fetchPage, stripScripts } from './html';
import { failed, type Resolved, type Resolver } from './types';

/* An Instagram post, read the sanctioned way.
 *
 * Meta's oEmbed endpoint has been tokenless for public posts since June 2026: it answers with the
 * embed markup and the author, and needs no app, no review and no account. What it does not
 * reliably carry is the caption — the fields that did were deprecated — so the caption comes from
 * the post's *captioned embed* page, which is the HTML Instagram itself serves inside every embed
 * and which carries the caption in a `.Caption` block. Both are public surfaces meant to be fetched
 * by third parties; neither is the logged-in web app, so there is no login wall to hit and no
 * account to put at risk.
 *
 * Order: embed page first (it has the caption), oEmbed second (author and a sanity check that the
 * post is public), Open Graph on the post page last. Each is optional; `error` says which fell
 * through.
 *
 * As of 2026-11 none of the three carries the caption any more: the embed page is a script shell
 * with no `.Caption`, oEmbed returns bare markup, and the post page is behind the login wall. The
 * resolver is kept for when that changes; meanwhile `caption_missing` is what the Add screen
 * answers with a box to paste the caption into. Nothing here goes around the login wall. */

const OEMBED = 'https://graph.facebook.com/v25.0/instagram_oembed';

interface Oembed {
  author_name?: string;
  title?: string;
  html?: string;
}

/** `/p/<code>/` or `/reel/<code>/` → the shortcode. */
export function shortcodeOf(url: URL): string | null {
  const match = url.pathname.match(/^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

/** The caption out of a captioned-embed page, or null. */
export function readEmbedCaption(html: string): string | null {
  const root = parse(html);
  const caption = root.querySelector('.Caption');
  if (!caption) return null;
  // The block starts with the username as a link; the caption text follows it.
  for (const link of caption.querySelectorAll('a.CaptionUsername, .CaptionComments')) link.remove();
  const text = cleanText(caption.structuredText);
  return text || null;
}

export const instagramOembedResolver: Resolver = {
  id: 'instagram-oembed',
  async resolve(url): Promise<Resolved> {
    const code = shortcodeOf(url);
    if (!code) return failed('not_a_post', url);
    const postUrl = `https://www.instagram.com/p/${code}/`;

    let caption: string | null = null;
    let body = '';
    let error: string | null = null;
    try {
      const embed = await fetchPage(new URL(`${postUrl}embed/captioned/`));
      if (embed.status < 400) {
        caption = readEmbedCaption(embed.text);
        body = capBody(stripScripts(embed.text));
      } else error = `embed_http_${embed.status}`;
    } catch {
      error = 'embed_fetch_failed';
    }

    let author: string | null = null;
    try {
      const params = new URLSearchParams({ url: postUrl, omitscript: 'true' });
      const res = await fetch(`${OEMBED}?${params}`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const oembed = (await res.json()) as Oembed;
        author = oembed.author_name ?? null;
        if (!caption && oembed.title) caption = cleanText(oembed.title);
      } else if (!caption) error = `oembed_http_${res.status}`;
    } catch {
      if (!caption) error = 'oembed_fetch_failed';
    }

    if (!caption) {
      const fallback = await resolveOpenGraph(new URL(postUrl));
      if (fallback.text) return { ...fallback, error: error ?? 'caption_missing' };
      return { ...fallback, error: fallback.error ?? error ?? 'caption_missing' };
    }

    const text = capText(author ? `${author}\n${caption}` : caption);
    return {
      canonicalUrl: canonicalize(postUrl),
      contentType: 'text/html',
      body,
      text,
      error: null,
      title: author,
    };
  },
};
