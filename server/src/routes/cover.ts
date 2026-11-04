import { Hono } from 'hono';

/* Posters from CDNs that refuse to be hotlinked.
 *
 * Douban's image hosts answer 418 to any Referer that is not douban.com — and to none at all, so
 * `referrerPolicy="no-referrer"` cannot help. This fetches the image server-side with the Referer
 * the CDN wants and hands it back. It is not an open proxy: only the hosts below are accepted,
 * only https, only an image comes back, and the size is capped. Posters do not change once
 * published, so the answer is cached for a year by whoever sits in between.
 *
 * Public, like /api/health: an <img> carries no session token in the native app. */

const REFERER_BY_HOST_SUFFIX: Record<string, string> = {
  '.doubanio.com': 'https://www.douban.com/',
};
const MAX_BYTES = 5 * 1024 * 1024;

/** The Referer a URL's host needs, or null if this route does not serve that host. */
export function refererFor(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  for (const [suffix, referer] of Object.entries(REFERER_BY_HOST_SUFFIX))
    if (url.hostname.endsWith(suffix)) return referer;
  return null;
}

export const coverRouter = new Hono().get('/', async (c) => {
  const target = c.req.query('url') ?? '';
  const referer = refererFor(target);
  if (!referer) return c.json({ error: 'errors.forbidden' }, 403);

  const res = await fetch(target, {
    headers: { Referer: referer, 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const type = res?.headers.get('content-type') ?? '';
  const length = Number(res?.headers.get('content-length') ?? 0);
  if (!res?.ok || !type.startsWith('image/') || length > MAX_BYTES)
    return c.json({ error: 'errors.not_found' }, 404);

  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return c.json({ error: 'errors.not_found' }, 404);
  return new Response(body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
