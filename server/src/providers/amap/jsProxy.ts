import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from '../../config';

/* The server-side half of the browser map's key.
 *
 * Amap's JS API pairs the public key (inlined into the bundle) with a 安全密钥 that must not ship.
 * Their sanctioned answer is exactly this: the page sets `_AMapSecurityConfig.serviceHost` to a
 * path on its own origin, the SDK sends its data requests there, and the origin forwards them to
 * Amap with `jscode=<secret>` appended. The three routes below are the three Amap documents for
 * an nginx deployment, translated. https://lbs.amap.com/api/javascript-api-v2/guide/abc/load
 *
 * Origin-checked rather than session-checked: the SDK issues these as plain script and fetch
 * requests, so a cookie is not guaranteed, but a browser always sends Origin or Referer for them
 * and neither can be forged from another site. Anyone who can reach the proxy from *this* origin
 * already has the page, so nothing is gained by asking more of them. */

const UPSTREAM: { prefix: string; target: string }[] = [
  { prefix: '/v4/map/styles', target: 'https://webapi.amap.com/v4/map/styles' },
  { prefix: '/v3/vectormap', target: 'https://fmap01.amap.com/v3/vectormap' },
  { prefix: '/', target: 'https://restapi.amap.com/' },
];

export const amapJsProxy = (trustedOrigins: readonly string[]) =>
  new Hono()
    // The Android app calls this cross-origin (from https://localhost), and the SDK reads the JSON.
    .use('/*', cors({ origin: [...trustedOrigins] }))
    .get('/*', async (c) => {
      if (!config.amapJsSecurityCode) return c.json({ error: 'geocode.not_configured' }, 503);
      const origin = c.req.header('origin') ?? originOf(c.req.header('referer'));
      if (!origin || !trustedOrigins.includes(origin))
        return c.json({ error: 'errors.forbidden' }, 403);

      const path = c.req.path.replace(/^\/_AMapService/, '') || '/';
      const rule = UPSTREAM.find((r) => path.startsWith(r.prefix)) ?? UPSTREAM[UPSTREAM.length - 1];
      const upstream = new URL(rule.target + path.slice(rule.prefix.length).replace(/^\/+/, ''));
      const incoming = new URL(c.req.url);
      incoming.searchParams.forEach((value, key) => upstream.searchParams.append(key, value));
      upstream.searchParams.set('jscode', config.amapJsSecurityCode);

      const res = await fetch(upstream, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (!res) return c.json({ error: 'geocode.upstream' }, 502);
      return new Response(res.body, {
        status: res.status,
        headers: {
          'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
          'Cache-Control': res.headers.get('cache-control') ?? 'no-store',
        },
      });
    });

const originOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};
