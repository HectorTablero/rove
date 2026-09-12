import { INGEST_RATE_LIMIT, INGEST_RATE_WINDOW_MS, sourceIdSchema } from '@rove/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../middleware/session';
import { rateLimit } from '../middleware/rateLimit';
import { jsonValidator } from '../middleware/validate';
import { pollSource, pollUser, sourceStatuses } from '../services/pollService';

/* The feeds, from the account's side: what each one did last, and a button to run it now. */

const pollSchema = z.object({ sourceId: sourceIdSchema.optional() });

export const sourcesRouter = new Hono<AppEnv>()
  .get('/status', async (c) => c.json({ sources: await sourceStatuses(c.get('userId')) }))
  .post(
    '/poll',
    rateLimit({
      limit: INGEST_RATE_LIMIT,
      windowMs: INGEST_RATE_WINDOW_MS,
      code: 'poll.rate_limited',
    }),
    jsonValidator(pollSchema),
    async (c) => {
      const userId = c.get('userId');
      const { sourceId } = c.req.valid('json');
      const runs = sourceId
        ? [await pollSource(userId, sourceId, 'manual')]
        : await pollUser(userId, 'manual');
      return c.json({ runs });
    },
  );
