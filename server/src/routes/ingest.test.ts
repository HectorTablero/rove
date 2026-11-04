import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../errors';
import type { AppEnv } from '../middleware/session';

/* /extract is streamed so a slow model outlasts proxy timeouts: whitespace first, then the JSON.
   What has to hold is that the body still parses as the same JSON, and that a failure — which can
   no longer change the status — arrives as `{ error }` with its code. */

const extract = vi.hoisted(() => ({ extractMentions: vi.fn() }));
vi.mock('../services/extractService', () => extract);
vi.mock('../middleware/rateLimit', () => ({
  rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

const { ingestRouter } = await import('./ingest');
const app = new Hono<AppEnv>()
  .use(async (c, next) => {
    c.set('userId', 'u1');
    await next();
  })
  .route('/', ingestRouter);

const post = () =>
  app.request('/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '盐田云海广场' }),
  });

beforeEach(() => {
  extract.extractMentions.mockReset();
});

describe('POST /extract', () => {
  it('answers with whitespace and then the extraction, which still parses as JSON', async () => {
    const mention = {
      nameText: '盐田云海广场',
      addressText: null,
      searchText: null,
      evidence: '盐田云海广场',
    };
    extract.extractMentions.mockResolvedValue({ model: 'm', mentions: [mention] });

    const res = await post();
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(body.startsWith(' ')).toBe(true);
    expect(JSON.parse(body)).toMatchObject({ model: 'm', mentions: [mention] });
  });

  it('carries a failure as { error } with its code', async () => {
    extract.extractMentions.mockImplementation(async () => {
      throw new HttpError(504, 'ai.timeout');
    });
    const res = await post();
    expect(JSON.parse(await res.text())).toEqual({ error: 'ai.timeout' });
  });
});
