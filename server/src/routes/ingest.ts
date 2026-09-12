import {
  INGEST_RATE_LIMIT,
  INGEST_RATE_WINDOW_MS,
  MAX_SNAPSHOT_TEXT_LENGTH,
  regionIdSchema,
  urlSchema,
} from '@rove/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { badRequest } from '../errors';
import type { AppEnv } from '../middleware/session';
import { rateLimit } from '../middleware/rateLimit';
import { jsonValidator } from '../middleware/validate';
import { trackEvent } from '../lib/telemetry';
import { extractMentions } from '../services/extractService';
import { resolveUrl } from '../sources';

/* The two steps of a paste the browser cannot do for itself: fetching a page cross-origin, and
   calling the model with a key that lives here. Both are stateless — the client owns the Snapshot
   row and writes what comes back into it through its outbox — so a phone that pasted offline has
   a row already, and only the fetch waits for the network. */

const resolveSchema = z.object({ url: urlSchema, region: regionIdSchema });
const extractSchema = z.object({ text: z.string().min(1).max(MAX_SNAPSHOT_TEXT_LENGTH) });

export const ingestRouter = new Hono<AppEnv>()
  .use(
    rateLimit({
      limit: INGEST_RATE_LIMIT,
      windowMs: INGEST_RATE_WINDOW_MS,
      code: 'ingest.rate_limited',
    }),
  )
  .post('/resolve', jsonValidator(resolveSchema), async (c) => {
    const { url, region } = c.req.valid('json');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw badRequest('ingest.bad_url');
    }
    const startedAt = performance.now();
    const result = await resolveUrl(parsed, region);
    if (!result) throw badRequest('ingest.no_source');
    trackEvent('ingest_resolve', {
      source: result.sourceId,
      ok: result.resolved.error === null,
      error: result.resolved.error ?? undefined,
      text_chars: result.resolved.text.length,
      duration_ms: Math.round(performance.now() - startedAt),
    });
    return c.json({
      sourceId: result.sourceId,
      fetchedAt: new Date().toISOString(),
      ...result.resolved,
    });
  })
  .post('/extract', jsonValidator(extractSchema), async (c) => {
    const { text } = c.req.valid('json');
    const { model, mentions } = await extractMentions(c.get('userId'), text);
    return c.json({ model, at: new Date().toISOString(), mentions });
  });
