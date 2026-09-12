import { DEFAULT_SETTINGS } from '@rove/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelDouble, query, resetModels } from '../test/mongooseDouble';

/* The promises the inbox depends on: an entry already known is not created twice, a broken feed
   is a recorded run rather than a thrown error, and "down" means what the banner says it means. */

const Item = modelDouble();
const Snapshot = modelDouble();
const SourceRun = modelDouble();
const UserSettings = modelDouble();
const rss = vi.hoisted(() => ({ fetchFeed: vi.fn() }));
const settings = vi.hoisted(() => ({ getSettings: vi.fn() }));

vi.mock('../models/item', () => ({ Item }));
vi.mock('../models/snapshot', () => ({ Snapshot }));
vi.mock('../models/sourceRun', () => ({ SourceRun }));
vi.mock('../models/userSettings', () => ({ UserSettings }));
vi.mock('../sources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sources')>()),
  fetchFeed: rss.fetchFeed,
}));
vi.mock('./settingsService', () => settings);

const { pollSource, sourceStatuses } = await import('./pollService');

const entry = (title: string, link: string) => ({
  title,
  link,
  text: `演出时间：2026-10-02 20:00\n场馆：B10`,
  html: '',
  pubDate: null,
});

beforeEach(() => {
  resetModels(Item, Snapshot, SourceRun, UserSettings);
  settings.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, pollSources: ['damai'] });
  rss.fetchFeed.mockReset();
  Snapshot.create.mockImplementation(async () => ({ _id: 'snap' }) as never);
});

describe('pollSource', () => {
  it('creates a candidate with its snapshot for an unknown entry, and skips a known one', async () => {
    rss.fetchFeed.mockResolvedValue([entry('A', 'https://d/1'), entry('B', 'https://d/2')]);
    Item.exists.mockImplementation(async (filter: unknown) =>
      (filter as { sourceUrls: string }).sourceUrls === 'https://d/2' ? { _id: 'x' } : null,
    );

    const run = await pollSource('u1', 'damai');

    expect(run).toMatchObject({ ok: true, found: 2, created: 1, error: null });
    expect(Item.create).toHaveBeenCalledTimes(1);
    expect(Item.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        status: 'candidate',
        kind: 'event',
        title: 'A',
        sourceUrls: ['https://d/1'],
        venue: 'B10',
      }),
    );
    expect(SourceRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sourceId: 'damai', ok: true, found: 2, created: 1 }),
    );
  });

  it('records a failed feed as a run with its code instead of throwing', async () => {
    rss.fetchFeed.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'poll.rsshub_unreachable' }),
    );
    // Not an HttpError instance, so it is the generic exception path.
    const run = await pollSource('u1', 'damai');
    expect(run.ok).toBe(false);
    expect(run.error).toBe('poll.exception');
    expect(SourceRun.create).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('refuses a source the region does not serve, as a recorded run', async () => {
    settings.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      pollSources: ['instagram-oembed'],
    });
    const run = await pollSource('u1', 'instagram-oembed');
    expect(run.error).toBe('poll.not_pollable');
    expect(rss.fetchFeed).not.toHaveBeenCalled();
  });
});

describe('sourceStatuses', () => {
  const run = (ok: boolean, found: number) => ({
    at: new Date('2026-09-12T00:00:00.000Z'),
    ok,
    found,
    created: 0,
    error: ok ? null : 'poll.rsshub_http_500',
    trigger: 'schedule',
  });

  it('is down after two empty or failed runs, and not after one', async () => {
    SourceRun.find.mockReturnValue(query([run(true, 0), run(false, 0)]));
    expect((await sourceStatuses('u1'))[0]).toMatchObject({ sourceId: 'damai', down: true });

    SourceRun.find.mockReturnValue(query([run(true, 0), run(true, 12)]));
    expect((await sourceStatuses('u1'))[0].down).toBe(false);

    SourceRun.find.mockReturnValue(query([run(true, 0)]));
    expect((await sourceStatuses('u1'))[0].down).toBe(false);
  });
});
