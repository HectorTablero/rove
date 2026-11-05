import { DEFAULT_SETTINGS } from '@rove/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('../sources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sources')>();
  return { ...actual, fetchFeed: rss.fetchFeed, pollerById: vi.fn(actual.pollerById) };
});
vi.mock('./settingsService', () => settings);

const { pollSource, reparseStored, REPARSE_LIMIT, sourceStatuses } = await import('./pollService');
const sources = await import('../sources');
const actualSources = await vi.importActual<typeof import('../sources')>('../sources');

/* Damai's mapping with an event page that says the show runs 19:30–21:30, counting reads. */
const withPage = () => {
  const detail = vi.fn(async (draft: import('../sources').CandidateDraft) => ({
    ...draft,
    when: {
      start: '2026-10-02T11:30:00.000Z',
      end: '2026-10-02T13:30:00.000Z',
      tz: 'Asia/Shanghai',
      allDay: false,
    },
  }));
  vi.mocked(sources.pollerById).mockImplementation((id) => ({
    ...actualSources.pollerById(id),
    detail,
  }));
  return detail;
};

const entry = (title: string, link: string) => ({
  title,
  link,
  text: `演出时间：2026-10-02 20:00\n场馆：B10`,
  html: '',
  pubDate: null,
  image: null,
  categories: [],
});

beforeEach(() => {
  resetModels(Item, Snapshot, SourceRun, UserSettings);
  settings.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, pollSources: ['damai'] });
  rss.fetchFeed.mockReset();
  Snapshot.create.mockImplementation(async () => ({ _id: 'snap' }) as never);
  // Before the fixtures' 2 Oct show, so it is still to come.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-20T00:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pollSource', () => {
  it('creates a candidate with its snapshot for an unknown entry, and skips a known one', async () => {
    rss.fetchFeed.mockResolvedValue([entry('A', 'https://d/1'), entry('B', 'https://d/2')]);
    Item.findOne.mockImplementation((filter: unknown) =>
      query(
        (filter as { sourceUrls: string }).sourceUrls === 'https://d/2'
          ? { _id: 'x', status: 'saved' }
          : null,
      ),
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

  it('does not store a listing for an event that is already over', async () => {
    vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
    rss.fetchFeed.mockResolvedValue([entry('A', 'https://d/1')]);
    Item.findOne.mockImplementation(() => query(null));

    const run = await pollSource('u1', 'damai');

    expect(run).toMatchObject({ ok: true, found: 1, created: 0 });
    expect(Item.create).not.toHaveBeenCalled();
    expect(Snapshot.create).not.toHaveBeenCalled();
  });

  it('stores a film already released: its date opens a run, it does not end one', async () => {
    vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
    settings.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, pollSources: ['maoyan'] });
    rss.fetchFeed.mockResolvedValue([
      { ...entry('[8.5分] 片名', 'https://m/1'), text: '上映时间：2026-10-01' },
    ]);
    Item.findOne.mockImplementation(() => query(null));

    const run = await pollSource('u1', 'maoyan');

    expect(run).toMatchObject({ ok: true, created: 1 });
    expect(Item.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'film' }));
  });

  it('refreshes a known candidate with what the feed now says, and leaves a dismissed item alone', async () => {
    rss.fetchFeed.mockResolvedValue([
      { ...entry('A', 'https://d/1'), text: '演出时间：2026-10-02 20:00\n场馆：B10\n票价：380' },
      { ...entry('B', 'https://d/2'), text: '票价：99' },
    ]);
    Item.findOne.mockImplementation((filter: unknown) =>
      query(
        (filter as { sourceUrls: string }).sourceUrls === 'https://d/1'
          ? {
              _id: 'c1',
              status: 'candidate',
              price: null,
              coverUrl: null,
              categories: [],
              venue: 'B10',
              // As Mongo hands it back: Dates, schema key order.
              when: {
                start: new Date('2026-10-02T12:00:00.000Z'),
                end: null,
                tz: 'Asia/Shanghai',
                allDay: false,
              },
            }
          : { _id: 's1', status: 'dismissed', price: null },
      ),
    );

    const run = await pollSource('u1', 'damai');

    expect(run.created).toBe(0);
    // Only the field that changed is written: an unchanged row is not a row to re-sync.
    expect(Item.updateOne).toHaveBeenCalledTimes(1);
    expect(Item.updateOne).toHaveBeenCalledWith({ _id: 'c1' }, { $set: { price: '380' } });
  });

  it('replaces a candidate time window that was read wrong, and moves its expiry with it', async () => {
    rss.fetchFeed.mockResolvedValue([entry('A', 'https://d/1')]);
    // Stored by the old parser: a year off.
    Item.findOne.mockImplementation(() =>
      query({
        _id: 'c1',
        status: 'candidate',
        price: null,
        coverUrl: null,
        categories: [],
        venue: 'B10',
        when: {
          start: new Date('2027-10-02T12:00:00.000Z'),
          end: null,
          tz: 'Asia/Shanghai',
          allDay: false,
        },
      }),
    );

    await pollSource('u1', 'damai');

    expect(Item.updateOne).toHaveBeenCalledWith(
      { _id: 'c1' },
      {
        $set: expect.objectContaining({
          when: expect.objectContaining({ start: new Date('2026-10-02T12:00:00.000Z') }),
          expiresAt: expect.any(Date),
        }),
      },
    );
  });

  it('corrects a saved item too, without giving it an expiry', async () => {
    rss.fetchFeed.mockResolvedValue([entry('A', 'https://d/1')]);
    Item.findOne.mockImplementation(() =>
      query({
        _id: 's1',
        status: 'saved',
        price: null,
        coverUrl: null,
        categories: [],
        venue: 'B10',
        when: null,
      }),
    );

    await pollSource('u1', 'damai');

    const [, update] = Item.updateOne.mock.calls[0] as [unknown, { $set: Record<string, unknown> }];
    expect(update.$set.when).toMatchObject({ start: new Date('2026-10-02T12:00:00.000Z') });
    expect(update.$set).not.toHaveProperty('expiresAt');
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

describe('event pages', () => {
  afterEach(() => {
    vi.mocked(sources.pollerById).mockImplementation(actualSources.pollerById);
  });

  it('reads the page for a new item and keeps its window, marking it read', async () => {
    const detail = withPage();
    rss.fetchFeed.mockResolvedValue([entry('A', 'https://d/1')]);

    await pollSource('u1', 'damai');

    expect(detail).toHaveBeenCalledTimes(1);
    expect(Item.create).toHaveBeenCalledWith(
      expect.objectContaining({
        when: expect.objectContaining({ end: new Date('2026-10-02T13:30:00.000Z') }),
        detailAt: expect.any(Date),
      }),
    );
  });

  it('never lets the poorer feed window overwrite a page already read, nor reads it again', async () => {
    const detail = withPage();
    rss.fetchFeed.mockResolvedValue([entry('A', 'https://d/1')]);
    Item.findOne.mockImplementation(() =>
      query({
        _id: 'c1',
        status: 'saved',
        detailAt: new Date('2026-11-01T00:00:00.000Z'),
        price: null,
        coverUrl: null,
        categories: [],
        venue: 'B10',
        when: {
          start: new Date('2026-10-02T11:30:00.000Z'),
          end: new Date('2026-10-02T13:30:00.000Z'),
          tz: 'Asia/Shanghai',
          allDay: false,
        },
      }),
    );

    await pollSource('u1', 'damai');

    expect(detail).not.toHaveBeenCalled();
    expect(Item.updateOne).not.toHaveBeenCalled();
  });
});

describe('reparseStored', () => {
  const stored = {
    _id: 'c1',
    status: 'saved',
    regionId: 'shenzhen',
    snapshotIds: ['snap'],
    price: null,
    coverUrl: null,
    categories: [],
    venue: 'B10',
    // The old parser's reading: a year off.
    when: {
      start: new Date('2027-10-02T12:00:00.000Z'),
      end: null,
      tz: 'Asia/Shanghai',
      allDay: false,
    },
  };

  it('re-reads an active item from its snapshot, relative to when it was fetched', async () => {
    Item.countDocuments.mockResolvedValue(1);
    Item.find.mockReturnValue(query([stored]));
    Snapshot.findById.mockReturnValue(
      query({
        sourceId: 'damai',
        fetchedAt: new Date('2026-09-12T00:00:00.000Z'),
        body: JSON.stringify(entry('A', 'https://d/1')),
      }),
    );

    expect(await reparseStored()).toBe(1);
    expect(Item.updateOne).toHaveBeenCalledWith(
      { _id: 'c1' },
      { $set: { when: expect.objectContaining({ start: new Date('2026-10-02T12:00:00.000Z') }) } },
    );
  });

  it('does nothing above the limit', async () => {
    Item.countDocuments.mockResolvedValue(REPARSE_LIMIT + 1);
    expect(await reparseStored()).toBe(0);
    expect(Item.find).not.toHaveBeenCalled();
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
