import {
  INGEST_RATE_LIMIT,
  INGEST_RATE_WINDOW_MS,
  MAX_SNAPSHOT_TEXT_LENGTH,
  regionIdSchema,
  urlSchema,
} from '@rove/shared';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { badRequest, HttpError } from '../errors';
import type { AppEnv } from '../middleware/session';
import { rateLimit } from '../middleware/rateLimit';
import { jsonValidator } from '../middleware/validate';
import { captureError, trackEvent } from '../lib/telemetry';
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
  /* The model can take minutes (a self-hosted GPU busy with other work), and every proxy on the
     way has a read timeout: nginx gives up after 60 s of silence, Cloudflare after 100 s. So the
     answer is streamed — a space at once and every few seconds, then the JSON. Leading whitespace
     is still valid JSON. The status is committed by then, so a failure is a 200 carrying
     `{ error }`, which the client turns back into an ordinary API error. */
  .post('/extract', jsonValidator(extractSchema), (c) => {
    const { text } = c.req.valid('json');
    const userId = c.get('userId');
    c.header('Content-Type', 'application/json; charset=utf-8');
    c.header('Cache-Control', 'no-store');
    // nginx otherwise buffers the response and the spaces never leave it.
    c.header('X-Accel-Buffering', 'no');
    return stream(c, async (out) => {
      await out.write(' ');
      const beat = setInterval(() => void out.write(' ').catch(() => {}), KEEPALIVE_MS);
      try {
        const { model, mentions } = await extractMentions(userId, text);
        await out.write(JSON.stringify({ model, at: new Date().toISOString(), mentions }));
      } catch (err) {
        if (!(err instanceof HttpError)) captureError(err, { scope: 'extract' });
        await out.write(
          JSON.stringify({ error: err instanceof HttpError ? err.code : 'errors.unknown' }),
        );
      } finally {
        clearInterval(beat);
      }
    });
  });

const KEEPALIVE_MS = 10_000;
