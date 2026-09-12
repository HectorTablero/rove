import { INGEST_RATE_LIMIT, INGEST_RATE_WINDOW_MS, regionById, regionIdSchema } from '@rove/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../middleware/session';
import { rateLimit } from '../middleware/rateLimit';
import { queryValidator } from '../middleware/validate';
import { geocoderById } from '../providers';

/* Geocoding, proxied. The provider key lives here and only here; the browser asks by name and
   region and gets candidates with a datum and an opaque providerRef. Which provider answers is the
   region's business, read from the registry — this file does not know the word Amap. */

const suggestQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  region: regionIdSchema,
});

export const geocodeRouter = new Hono<AppEnv>()
  .use(
    rateLimit({
      limit: INGEST_RATE_LIMIT,
      windowMs: INGEST_RATE_WINDOW_MS,
      code: 'geocode.rate_limited',
    }),
  )
  .get('/suggest', queryValidator(suggestQuerySchema), async (c) => {
    const { q, region } = c.req.valid('query');
    const geocoder = geocoderById(regionById(region).geocoder);
    return c.json({ candidates: await geocoder.suggest(q, region) });
  })
  /** How much of this month's pool is spent — shown in Settings so the limit is never a surprise. */
  .get('/usage', queryValidator(z.object({ region: regionIdSchema })), async (c) => {
    const geocoder = geocoderById(regionById(c.req.valid('query').region).geocoder);
    return c.json({ configured: geocoder.configured(), ...(await geocoder.usage()) });
  });
