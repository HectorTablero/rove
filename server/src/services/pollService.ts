import {
  type RegionDescriptor,
  MAX_POLL_ITEMS_PER_RUN,
  regionById,
  sourceById,
  SOURCE_DOWN_AFTER_RUNS,
} from '@rove/shared';
import { Types } from 'mongoose';
import { HttpError } from '../errors';
import { captureError, trackEvent, userHash } from '../lib/telemetry';
import { Item } from '../models/item';
import { Snapshot } from '../models/snapshot';
import { SourceRun } from '../models/sourceRun';
import { UserSettings } from '../models/userSettings';
import { fetchFeed, pollerById, type CandidateDraft, type Poller } from '../sources';
import { getSettings } from './settingsService';

/* Polling: feed → candidates, per account, per source, each run isolated.
 *
 * A candidate is an Item with `status: 'candidate'` plus the Snapshot it came from, written here
 * on the server; the client pulls them like any other row. Dedupe is by link: an entry whose URL
 * is already on any item — saved, dismissed or still a candidate — is not created again, which is
 * what keeps a dismissed event dismissed across sixty runs.
 *
 * Every failure is recorded as a run and never thrown past one source: a broken Damai route must
 * not stop Douban from being read in the same pass. */

/* An item seen again picks up what the feed now says about it: a price, a poster, a venue or a
   time window that was missing or mis-read the first time. Candidates and saved items both —
   these fields only ever come from the source, the app has no way to edit them. Dismissed and
   visited rows are history and stay as they were. Written only on a real change, because every
   write bumps updatedAt and every bump is a row each device pulls. */
const REFRESHED_STATUSES = ['candidate', 'saved'] as const;
const REFRESHED = new Set<string>(REFRESHED_STATUSES);

type Known = {
  _id: Types.ObjectId;
  status: string;
  detailAt?: Date | null;
  [key: string]: unknown;
};

/* What an item's `when` should come from. A source with an event page (`poller.detail`) is read
   there once � when the item is created, or the first time it is seen without `detailAt` � and
   from then on the page's window stands and the feed's, which is poorer, is ignored. A page that
   cannot be read leaves the feed's draft in place and `detailAt` unset, so the next pass retries. */
async function withDetail(
  poller: Poller,
  draft: CandidateDraft,
  region: RegionDescriptor,
  now: Date,
  known: Known | null,
): Promise<{ draft: CandidateDraft; keepWhen: boolean; detailAt: Date | null }> {
  if (!poller.detail) return { draft, keepWhen: false, detailAt: null };
  if (known?.detailAt) return { draft, keepWhen: true, detailAt: null };
  const detailed = await poller.detail(draft, region, now).catch(() => null);
  return detailed
    ? { draft: detailed, keepWhen: false, detailAt: now }
    : { draft, keepWhen: false, detailAt: null };
}

async function refreshFromDraft(
  known: Known,
  {
    draft,
    keepWhen,
    detailAt,
  }: { draft: CandidateDraft; keepWhen: boolean; detailAt: Date | null },
): Promise<boolean> {
  if (!REFRESHED.has(known.status)) return false;
  const next: Record<string, unknown> = {
    price: draft.price,
    coverUrl: draft.coverUrl,
    categories: draft.categories,
    ...(draft.kind === 'event' ? { venue: draft.venue } : {}),
  };
  const changed = Object.fromEntries(
    Object.entries(next).filter(
      ([key, value]) => JSON.stringify(known[key] ?? null) !== JSON.stringify(value ?? null),
    ),
  );
  /* A re-read time window (a parser fix, a date the site corrected) replaces the stored one, in
     the stored shape so an unchanged window compares equal. The expiry moves with it — and only
     with it: an undated candidate's expiry is "a month from now", which differs on every poll. */
  const when = draft.when
    ? {
        start: new Date(draft.when.start),
        end: draft.when.end ? new Date(draft.when.end) : null,
        tz: draft.when.tz,
        allDay: draft.when.allDay,
      }
    : null;
  if (!keepWhen && JSON.stringify(known.when ?? null) !== JSON.stringify(when)) {
    changed.when = when;
    // Only a candidate expires; a saved item is the user's until they drop it.
    if (known.status === 'candidate') changed.expiresAt = new Date(draft.expiresAt);
  }
  if (detailAt) changed.detailAt = detailAt;
  if (!Object.keys(changed).length) return false;
  await Item.updateOne({ _id: known._id }, { $set: changed });
  return true;
}

/** Above this many active items the startup re-read is skipped rather than slowing a deploy. */
export const REPARSE_LIMIT = 1000;

/* Re-reads every active polled item (candidate or saved) from the snapshot it was created from,
   so a parser fix reaches rows the feeds no longer list — a saved event from last month will
   never be polled again. Runs at startup, i.e. once per deploy. Local data, except an item from a
   source with an event page that has not been read yet: that page is fetched, one at a time.
   `now` for each re-read is the snapshot's own fetch time, which is what a yearless date was
   relative to. Returns how many rows changed. */
export async function reparseStored(): Promise<number> {
  const filter = { status: { $in: [...REFRESHED_STATUSES] }, 'snapshotIds.0': { $exists: true } };
  // ponytail: all-or-nothing cap; page through by _id if accounts ever hold more than this.
  if ((await Item.countDocuments(filter)) > REPARSE_LIMIT) return 0;
  const items = await Item.find(filter).lean();
  let changed = 0;
  for (const item of items) {
    try {
      const snapshot = await Snapshot.findById(item.snapshotIds[0]).lean();
      if (!snapshot?.body) continue;
      const poller = pollerById(snapshot.sourceId);
      const region = regionById(item.regionId);
      const draft = poller.map(JSON.parse(snapshot.body), region, snapshot.fetchedAt);
      if (!draft) continue;
      const read = await withDetail(poller, draft, region, new Date(), item);
      if (await refreshFromDraft(item, read)) changed++;
    } catch {
      // A snapshot from a source that no longer polls, or a body that is not an entry: skip it.
    }
  }
  if (changed) trackEvent('items_reparsed', { count: changed });
  return changed;
}

export interface RunSummary {
  sourceId: string;
  ok: boolean;
  found: number;
  created: number;
  error: string | null;
}

export async function pollSource(
  userId: string,
  sourceId: string,
  trigger: 'schedule' | 'manual' = 'schedule',
): Promise<RunSummary> {
  const startedAt = performance.now();
  const now = new Date();
  let found = 0;
  let created = 0;
  let error: string | null = null;
  try {
    const settings = await getSettings(userId);
    const region = regionById(settings.regionId);
    const source = sourceById(sourceId);
    if (!source.polls) throw new HttpError(400, 'poll.not_pollable');
    if (source.regionIds !== '*' && !source.regionIds.includes(region.id)) {
      throw new HttpError(400, 'poll.wrong_region');
    }
    const poller = pollerById(sourceId);
    const entries = await fetchFeed(poller.route(region));
    found = entries.length;

    for (const entry of entries.slice(0, MAX_POLL_ITEMS_PER_RUN)) {
      const draft = poller.map(entry, region, now);
      if (!draft) continue;
      const known = await Item.findOne({ userId, sourceUrls: draft.link }).lean();
      if (known) {
        if (REFRESHED.has(known.status))
          await refreshFromDraft(known, await withDetail(poller, draft, region, now, known));
        continue;
      }
      const read = await withDetail(poller, draft, region, now, null);
      /* A listing for something already over is not a suggestion. Not stored, so it costs nothing.
         Not films: their date is the release, the first day of a run, and their expiry (see
         FILM_TTL_DAYS) is what says when the run is over. */
      const when = read.draft.when;
      if (draft.kind !== 'film' && when && Date.parse(when.end ?? when.start) < now.getTime())
        continue;

      const snapshot = await Snapshot.create({
        userId,
        sourceId,
        url: draft.link,
        canonicalUrl: draft.link,
        fetchedAt: now,
        contentType: 'application/rss+xml',
        body: JSON.stringify(draft.entry),
        text: draft.text,
        error: null,
        extraction: null,
      });
      await Item.create({
        userId,
        regionId: region.id,
        kind: draft.kind,
        title: draft.title,
        altTitles: [],
        categories: draft.categories,
        price: draft.price,
        coverUrl: draft.coverUrl,
        status: 'candidate',
        snapshotIds: [snapshot._id as Types.ObjectId],
        sourceUrls: [draft.link],
        expiresAt: new Date(read.draft.expiresAt),
        location: null,
        when: read.draft.when
          ? {
              start: new Date(read.draft.when.start),
              end: read.draft.when.end ? new Date(read.draft.when.end) : null,
              tz: read.draft.when.tz,
              allDay: read.draft.when.allDay,
            }
          : null,
        detailAt: read.detailAt,
        venue: draft.kind === 'event' ? draft.venue : null,
      });
      created++;
    }
  } catch (err) {
    error = err instanceof HttpError ? err.code : 'poll.exception';
    if (!(err instanceof HttpError)) captureError(err, { scope: 'poll', source: sourceId });
  }

  const ok = error === null;
  const durationMs = Math.round(performance.now() - startedAt);
  await SourceRun.create({
    userId,
    sourceId,
    at: now,
    ok,
    found,
    created,
    error,
    durationMs,
    trigger,
  });
  /* Never sampled: a poll is at most a handful of rows a day per account, and "found 0" is the
     row that matters — it is what the source-down banner is built from. */
  trackEvent('poll_run', {
    user: userHash(userId),
    source: sourceId,
    ok,
    found,
    created,
    error: error ?? undefined,
    duration_ms: durationMs,
    trigger,
  });
  return { sourceId, ok, found, created, error };
}

/** Every enabled source of one account, in sequence so one feed's slowness never overlaps itself. */
export async function pollUser(userId: string, trigger: 'schedule' | 'manual' = 'schedule') {
  const { pollSources } = await getSettings(userId);
  const results: RunSummary[] = [];
  for (const sourceId of pollSources) results.push(await pollSource(userId, sourceId, trigger));
  return results;
}

/** Every account that has switched a source on. The scheduler's entry point. */
export async function pollAll(): Promise<void> {
  const users = await UserSettings.find(
    { pollSources: { $exists: true, $ne: [] } },
    'userId',
  ).lean();
  for (const { userId } of users) {
    try {
      await pollUser(userId);
    } catch (err) {
      captureError(err, { scope: 'pollAll', user: userHash(userId) });
    }
  }
}

export interface SourceStatus {
  sourceId: string;
  /** Two failed or empty runs in a row: the banner condition. */
  down: boolean;
  lastRun: {
    at: string;
    ok: boolean;
    found: number;
    created: number;
    error: string | null;
    trigger: string;
  } | null;
}

/** The last runs of every source this account polls, and whether each looks down. */
export async function sourceStatuses(userId: string): Promise<SourceStatus[]> {
  const { pollSources } = await getSettings(userId);
  return Promise.all(
    pollSources.map(async (sourceId) => {
      const runs = await SourceRun.find({ userId, sourceId })
        .sort({ at: -1 })
        .limit(SOURCE_DOWN_AFTER_RUNS)
        .lean();
      const last = runs[0];
      return {
        sourceId,
        down:
          runs.length >= SOURCE_DOWN_AFTER_RUNS && runs.every((run) => !run.ok || run.found === 0),
        lastRun: last
          ? {
              at: last.at.toISOString(),
              ok: last.ok,
              found: last.found,
              created: last.created,
              error: last.error ?? null,
              trigger: last.trigger,
            }
          : null,
      };
    }),
  );
}

/** Candidates nobody acted on and that have expired: gone, with tombstones. Clients already hide
    them, so there is nothing to wait for; a poll will not bring a finished event back (see
    pollSource), and a saved item never expires. */
export async function sweepExpiredCandidates(now = new Date()): Promise<number> {
  const stale = await Item.find(
    { status: 'candidate', expiresAt: { $lt: now } },
    '_id userId',
  ).lean();
  if (!stale.length) return 0;
  const { recordDeletions } = await import('../models/deletion');
  const byUser = new Map<string, Types.ObjectId[]>();
  for (const row of stale as { _id: Types.ObjectId; userId: string }[]) {
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row._id]);
  }
  for (const [userId, ids] of byUser) {
    await Item.deleteMany({ userId, _id: { $in: ids } });
    await recordDeletions(userId, 'item', ids);
  }
  trackEvent('candidates_swept', { count: stale.length });
  return stale.length;
}
